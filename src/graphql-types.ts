export interface GraphQLPullRequestNode {
  number: number;
  state: string;
  merged: boolean;
  mergeable: string;
  isDraft: boolean;
  labels: {
    nodes: Array<{
      name: string;
    }>;
  };
  baseRef: {
    name: string;
    target: {
      oid: string;
    };
  };
  headRef: {
    name: string;
    target: {
      oid: string;
    };
  } | null;
  headRepository: {
    name: string;
    owner: {
      login: string;
    };
  } | null;
}

export interface GraphQLPullRequestsResponse {
  repository: {
    pullRequests: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: GraphQLPullRequestNode[];
    };
  };
}
