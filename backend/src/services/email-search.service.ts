import { esClient, ELASTICSEARCH_INDEX, initEmailIndex } from "./elasticsearch.service";
import {
  searchEmailQuerySchema,
  SearchEmailQueryInput,
  EmailSearchResponse,
  SafeEmailResult,
} from "../validators/email-search.validator";

export async function searchUserEmails(
  userId: string,
  rawInput: SearchEmailQueryInput
): Promise<EmailSearchResponse> {
  await initEmailIndex();

  const input = searchEmailQuerySchema.parse(rawInput);

  const textQuery = input.q || input.query;
  const senderFilter = input.senderId || input.sender;
  const start = input.startDate || input.from;
  const end = input.endDate || input.to;
  const dateField = input.dateField || "scheduledAt";
  const page = input.page || 1;
  const limit = input.limit || 20;
  const from = (page - 1) * limit;

  const filterClauses: any[] = [
    { term: { userId } },
  ];

  if (input.status) {
    filterClauses.push({ term: { status: input.status } });
  }

  if (senderFilter) {
    filterClauses.push({ term: { senderId: senderFilter } });
  }

  if (start || end) {
    const rangeClause: any = {};
    if (start) rangeClause.gte = start;
    if (end) rangeClause.lte = end;
    filterClauses.push({ range: { [dateField]: rangeClause } });
  }

  let mustClause: any[];
  if (textQuery && textQuery.trim().length > 0) {
    mustClause = [
      {
        multi_match: {
          query: textQuery.trim(),
          fields: [
            "subject^3",
            "body^2",
            "recipientEmail^3",
            "recipientEmail.text^2",
          ],
          type: "best_fields",
          operator: "and",
        },
      },
    ];
  } else {
    mustClause = [{ match_all: {} }];
  }

  const sortBy = input.sortBy || "scheduledAt";
  const sortOrder = input.sortOrder || "desc";

  const sortClauses: any[] = [
    { [sortBy]: { order: sortOrder } },
  ];

  if (textQuery && textQuery.trim().length > 0) {
    sortClauses.unshift({ _score: { order: "desc" } });
  }

  const response = await esClient.search({
    index: ELASTICSEARCH_INDEX,
    from,
    size: limit,
    query: {
      bool: {
        must: mustClause,
        filter: filterClauses,
      },
    },
    sort: sortClauses,
  });

  const total =
    typeof response.hits.total === "number"
      ? response.hits.total
      : response.hits.total?.value || 0;

  const emails: SafeEmailResult[] = response.hits.hits.map((hit) => {
    const source = hit._source as any;
    return {
      id: source.id,
      campaignId: source.campaignId,
      senderId: source.senderId,
      recipientEmail: source.recipientEmail,
      subject: source.subject,
      body: source.body,
      status: source.status,
      scheduledAt: source.scheduledAt,
      nextEligibleAt: source.nextEligibleAt || null,
      sentAt: source.sentAt || null,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  });

  return {
    emails,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
