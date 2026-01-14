import 'jest-ts-auto-mock';

// Mock @octokit/graphql to avoid ES module issues
jest.mock('@octokit/graphql', () => {
  const mockGraphqlFn: any = jest.fn().mockResolvedValue({
    repository: {
      pullRequests: {
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
        nodes: [],
      },
    },
  });

  // defaults() should return the same mock function so test mocks apply
  mockGraphqlFn.defaults = jest.fn(() => mockGraphqlFn);
  mockGraphqlFn.withCustomRequest = jest.fn(() => mockGraphqlFn);

  return {
    graphql: mockGraphqlFn,
  };
});
