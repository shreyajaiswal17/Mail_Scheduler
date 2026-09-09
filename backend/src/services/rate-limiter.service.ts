import { redis } from "../lib/redis";

export interface ReserveSlotOptions {
  senderId: string;
  campaignId?: string | null;
  campaignDelayMs?: number | null;
  campaignHourlyLimit?: number | null;
}

export type RateLimitReason =
  | "SENDER_MIN_DELAY"
  | "CAMPAIGN_MIN_DELAY"
  | "SENDER_HOURLY_LIMIT"
  | "CAMPAIGN_HOURLY_LIMIT"
  | "ALLOWED";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  reason: RateLimitReason;
  senderHourlyLimit: number;
  senderMinDelayMs: number;
  campaignHourlyLimit?: number | null;
  campaignDelayMs?: number | null;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

const RATE_LIMIT_LUA_SCRIPT = `
local now = tonumber(ARGV[1])
local senderMinDelayMs = tonumber(ARGV[2])
local senderHourlyLimit = tonumber(ARGV[3])
local campaignDelayMs = tonumber(ARGV[4])
local campaignHourlyLimit = tonumber(ARGV[5])
local windowEndMs = tonumber(ARGV[6])

local hasCampaign = #KEYS >= 4

local senderLastSend = tonumber(redis.call('GET', KEYS[1]) or '0')
if senderLastSend > 0 and (now - senderLastSend) < senderMinDelayMs then
    local remaining = senderMinDelayMs - (now - senderLastSend)
    return {0, remaining, 'SENDER_MIN_DELAY'}
end

if hasCampaign and campaignDelayMs > 0 then
    local campaignLastSend = tonumber(redis.call('GET', KEYS[3]) or '0')
    if campaignLastSend > 0 and (now - campaignLastSend) < campaignDelayMs then
        local remaining = campaignDelayMs - (now - campaignLastSend)
        return {0, remaining, 'CAMPAIGN_MIN_DELAY'}
    end
end

local senderHourlyCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if senderHourlyCount >= senderHourlyLimit then
    local remainingToNextHour = windowEndMs - now
    if remainingToNextHour < 1000 then
        remainingToNextHour = 1000
    end
    return {0, remainingToNextHour, 'SENDER_HOURLY_LIMIT'}
end

if hasCampaign and campaignHourlyLimit > 0 then
    local campaignHourlyCount = tonumber(redis.call('GET', KEYS[4]) or '0')
    if campaignHourlyCount >= campaignHourlyLimit then
        local remainingToNextHour = windowEndMs - now
        if remainingToNextHour < 1000 then
            remainingToNextHour = 1000
        end
        return {0, remainingToNextHour, 'CAMPAIGN_HOURLY_LIMIT'}
    end
end

redis.call('SET', KEYS[1], tostring(now), 'EX', 86400)
redis.call('INCR', KEYS[2])
local senderTtl = redis.call('TTL', KEYS[2])
if senderTtl < 0 then
    redis.call('EXPIRE', KEYS[2], 7200)
end

if hasCampaign then
    if campaignDelayMs > 0 then
        redis.call('SET', KEYS[3], tostring(now), 'EX', 86400)
    end
    if campaignHourlyLimit > 0 then
        redis.call('INCR', KEYS[4])
        local campaignTtl = redis.call('TTL', KEYS[4])
        if campaignTtl < 0 then
            redis.call('EXPIRE', KEYS[4], 7200)
        end
    end
end

return {1, 0, 'ALLOWED'}
`;

export async function reserveSendingSlot(
  options: ReserveSlotOptions
): Promise<RateLimitResult> {
  const { senderId, campaignId, campaignDelayMs, campaignHourlyLimit } = options;

  const now = Date.now();

  const senderMinDelayMs = Number(process.env.MIN_DELAY_MS || 2000);
  const senderHourlyLimit = Number(
    process.env.MAX_EMAILS_PER_HOUR_PER_SENDER || 100
  );

  const resolvedCampaignDelay =
    campaignDelayMs && campaignDelayMs > 0 ? campaignDelayMs : 0;
  const resolvedCampaignHourly =
    campaignHourlyLimit && campaignHourlyLimit > 0 ? campaignHourlyLimit : 0;

  const windowStartMs = Math.floor(now / ONE_HOUR_MS) * ONE_HOUR_MS;
  const windowEndMs = windowStartMs + ONE_HOUR_MS;

  const senderLastSendKey = `ratelimit:sender:${senderId}:last_send`;
  const senderHourlyWindowKey = `ratelimit:sender:${senderId}:hourly:${windowStartMs}`;

  const keys: string[] = [senderLastSendKey, senderHourlyWindowKey];

  if (campaignId) {
    const campaignLastSendKey = `ratelimit:campaign:${campaignId}:last_send`;
    const campaignHourlyWindowKey = `ratelimit:campaign:${campaignId}:hourly:${windowStartMs}`;
    keys.push(campaignLastSendKey, campaignHourlyWindowKey);
  }

  const rawResult = (await redis.eval(
    RATE_LIMIT_LUA_SCRIPT,
    keys.length,
    ...keys,
    now.toString(),
    senderMinDelayMs.toString(),
    senderHourlyLimit.toString(),
    resolvedCampaignDelay.toString(),
    resolvedCampaignHourly.toString(),
    windowEndMs.toString()
  )) as [number, number, string];

  const allowed = rawResult[0] === 1;
  const retryAfterMs = Number(rawResult[1]) || 0;
  const reason = rawResult[2] as RateLimitReason;

  return {
    allowed,
    retryAfterMs,
    reason,
    senderHourlyLimit,
    senderMinDelayMs,
    campaignHourlyLimit: resolvedCampaignHourly || null,
    campaignDelayMs: resolvedCampaignDelay || null,
  };
}

