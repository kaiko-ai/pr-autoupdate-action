export interface GraphQLPullRequestNode {
  number: number;
  state: string;
  merged: boolean;
  mergeable: string;
  draft: boolean;
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
  };
  headRepository: {
    name: string;
    owner: {
      login: string;
    };
  } | null;
  comparison: {
    aheadBy: number;
    behindBy: number;
    status: string;
  };
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

export interface GraphQLPullRequest {
  number: number;
  state: string;
  merged: boolean;
  draft: boolean;
  labels: Array<{ name: string }>;
  base: {
    ref: string;
    label: string;
    sha: string;
  };
  head: {
    ref: string;
    label: string;
    sha: string;
    repo: {
      name: string;
      owner: {
        login: string;
      };
    } | null;
  };
  behindBy: number;
}
