// Mock for @octokit/graphql to avoid ES module import issues in Jest
const mockGraphqlFn: any = async () => ({});

mockGraphqlFn.defaults = () => mockGraphqlFn;
mockGraphqlFn.withCustomRequest = () => mockGraphqlFn;

export const graphql = mockGraphqlFn;
