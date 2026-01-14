import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import * as ghCore from '@actions/core';
import * as octokit from '@octokit/types';
import {
  PullRequestEvent,
  PushEvent,
  WebhookEvent,
  WorkflowRunEvent,
  WorkflowDispatchEvent,
} from '@octokit/webhooks-types/schema';
import { graphql } from '@octokit/graphql';
import { ConfigLoader } from './config-loader';
import { Output } from './Output';
import { isRequestError } from './helpers/isRequestError';
import {
  GraphQLPullRequestsResponse,
  GraphQLPullRequestNode,
} from './graphql-types';

type PullRequestResponse =
  octokit.Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}']['response'];
type MergeParameters =
  octokit.Endpoints['POST /repos/{owner}/{repo}/merges']['parameters'];

type PullRequest =
  | PullRequestResponse['data']
  | PullRequestEvent['pull_request'];

// Minimal PR structure required for update operations
// Used when converting GraphQL responses to a REST-compatible format
type UpdateablePullRequest = {
  number: number;
  state: string;
  merged: boolean;
  draft: boolean;
  labels: Array<{ name?: string }>;
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
  auto_merge?: any; // Optional field used by prNeedsUpdate for auto_merge filter
};

type SetOutputFn = typeof ghCore.setOutput;

export class AutoUpdater {
  // See https://docs.github.com/en/developers/webhooks-and-events/webhook-events-and-payloads
  eventData: WebhookEvent;
  config: ConfigLoader;
  octokit: InstanceType<typeof GitHub>;

  constructor(config: ConfigLoader, eventData: WebhookEvent) {
    this.eventData = eventData;
    this.config = config;
    this.octokit = github.getOctokit(this.config.githubToken());
  }

  async handlePush(): Promise<number> {
    const { ref, repository } = this.eventData as PushEvent;

    ghCore.info(`Handling push event on ref '${ref}'`);

    // Use GraphQL if enabled via environment variable
    if (process.env.USE_GRAPHQL_API === 'true') {
      return await this.pullsWithGraphQL(
        ref,
        repository.name,
        repository.owner.login,
        repository.owner.name,
      );
    }

    return await this.pulls(
      ref,
      repository.name,
      repository.owner.login,
      repository.owner.name,
    );
  }

  async handlePullRequest(): Promise<boolean> {
    const { action, pull_request } = this.eventData as PullRequestEvent;

    ghCore.info(`Handling pull_request event triggered by action '${action}'`);

    if (!pull_request.head.repo) {
      ghCore.warning('Pull request head repository is null, skipping update');
      return false;
    }

    const isUpdated = await this.update(
      pull_request.head.repo.owner.login,
      pull_request,
    );
    if (isUpdated) {
      ghCore.info(
        'Auto update complete, pull request branch was updated with changes from the base branch.',
      );
    } else {
      ghCore.info('Auto update complete, no changes were made.');
    }

    return isUpdated;
  }

  async handleSchedule(): Promise<number> {
    const ref = this.config.githubRef();
    const ownerAndRepo = this.config.githubRepository();

    const splitRepoName = ownerAndRepo.split('/');

    if (splitRepoName.length !== 2) {
      ghCore.error(`Cannot parse GITHUB_REPOSITORY value ${ownerAndRepo}`);
      return 0;
    }

    const repoOwner = splitRepoName[0];
    const repoName = splitRepoName[1];

    ghCore.info(`Handling schedule event on '${ref}'`);

    return await this.pulls(ref, repoName, repoOwner);
  }

  async handleWorkflowRun(): Promise<number> {
    const { workflow_run: workflowRun, repository } = this
      .eventData as WorkflowRunEvent;
    const { head_branch: branch, event } = workflowRun;

    if (!['push', 'pull_request'].includes(event)) {
      ghCore.error(
        `workflow_run events triggered via ${event} workflows are not supported.`,
      );
      return 0;
    }

    // This may not be possible given the check above, but here for safety.
    if (!branch) {
      ghCore.warning('Event was not on a branch, skipping.');
      return 0;
    }

    ghCore.info(
      `Handling workflow_run event triggered by '${event}' on '${branch}'`,
    );

    // The `pull_request` event is handled the same way as `push` as we may
    // get multiple PRs.
    return await this.pulls(
      `refs/heads/${branch}`,
      repository.name,
      repository.owner.login,
      repository.owner.name,
    );
  }

  async handleWorkflowDispatch(): Promise<number> {
    const { ref, repository } = this.eventData as WorkflowDispatchEvent;

    ghCore.info(`Handling workflow_dispatch event on ref '${ref}'`);

    return await this.pulls(
      ref,
      repository.name,
      repository.owner.login,
      repository.owner.name,
    );
  }

  async pulls(
    ref: string,
    repoName: string,
    repoOwnerLogin: string,
    repoOwnerName?: string,
  ): Promise<number> {
    if (!ref.startsWith('refs/heads/')) {
      ghCore.warning('Push event was not on a branch, skipping.');
      return 0;
    }

    const baseBranch = ref.replace('refs/heads/', '');

    const owner = repoOwnerName ?? repoOwnerLogin;

    if (!owner) {
      ghCore.error('Invalid repository owner provided');
      return 0;
    }
    if (!repoName) {
      ghCore.error('Invalid repository name provided');
      return 0;
    }

    let updated = 0;
    const paginatorOpts = this.octokit.rest.pulls.list.endpoint.merge({
      owner: owner,
      repo: repoName,
      base: baseBranch,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
    });

    let pullsPage: octokit.OctokitResponse<any>;
    for await (pullsPage of this.octokit.paginate.iterator(paginatorOpts)) {
      let pull: PullRequestResponse['data'];
      for (pull of pullsPage.data) {
        ghCore.startGroup(`PR-${pull.number}`);
        const isUpdated = await this.update(owner, pull);
        ghCore.endGroup();

        if (isUpdated) {
          updated++;
        }
      }
    }

    ghCore.info(
      `Auto update complete, ${updated} pull request(s) that point to base branch '${baseBranch}' were updated.`,
    );

    return updated;
  }

  async pullsWithGraphQL(
    ref: string,
    repoName: string,
    repoOwnerLogin: string,
    repoOwnerName?: string,
  ): Promise<number> {
    if (!ref.startsWith('refs/heads/')) {
      ghCore.warning('Push event was not on a branch, skipping.');
      return 0;
    }

    const baseBranch = ref.replace('refs/heads/', '');
    const owner = repoOwnerName ?? repoOwnerLogin;

    if (!owner) {
      ghCore.error('Invalid repository owner provided');
      return 0;
    }
    if (!repoName) {
      ghCore.error('Invalid repository name provided');
      return 0;
    }

    const graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${this.config.githubToken()}`,
      },
    });

    let updated = 0;
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      let result: GraphQLPullRequestsResponse;

      try {
        result = await graphqlWithAuth({
          query: `
            query($owner: String!, $repo: String!, $base: String!, $cursor: String) {
              repository(owner: $owner, name: $repo) {
                pullRequests(
                  baseRefName: $base
                  states: [OPEN]
                  first: 100
                  after: $cursor
                  orderBy: {field: UPDATED_AT, direction: DESC}
                ) {
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                  nodes {
                    number
                    state
                    merged
                    mergeable
                    isDraft
                    labels(first: 10) {
                      nodes {
                        name
                      }
                    }
                    baseRef {
                      name
                      target {
                        ... on Commit {
                          oid
                        }
                      }
                    }
                    headRef {
                      name
                      target {
                        ... on Commit {
                          oid
                        }
                      }
                    }
                    headRepository {
                      name
                      owner {
                        login
                      }
                    }
                  }
                }
              }
            }
          `,
          owner,
          repo: repoName,
          base: baseBranch,
          cursor,
        });
      } catch (e: unknown) {
        if (e instanceof Error) {
          // Handle specific GraphQL errors
          if ('status' in e) {
            const status = (e as any).status;
            if (status === 401 || status === 403) {
              ghCore.error(
                `Authentication error when calling GraphQL API: ${e.message}`,
              );
              ghCore.error(
                'Please check that your GitHub token has the required permissions.',
              );
            } else if (status === 429) {
              ghCore.error(`Rate limit exceeded when calling GraphQL API`);
              ghCore.error(
                'Please wait before retrying or check your rate limit status.',
              );
            } else {
              ghCore.error(`GraphQL API error (status ${status}): ${e.message}`);
            }
          } else {
            ghCore.error(`Error calling GraphQL API: ${e.message}`);
          }
        } else {
          ghCore.error(`Unknown error calling GraphQL API`);
        }
        // Return early with count of PRs updated so far
        return updated;
      }

      const prs = result.repository.pullRequests.nodes;

      for (const pr of prs) {
        ghCore.startGroup(`PR-${pr.number}`);

        // Convert GraphQL PR to REST-like format for update() method
        const pullForUpdate = this.convertGraphQLPRToREST(pr, owner);

        if (!pullForUpdate) {
          ghCore.endGroup();
          continue;
        }

        const isUpdated = await this.update(owner, pullForUpdate);

        ghCore.endGroup();

        if (isUpdated) {
          updated++;
        }
      }

      hasNextPage = result.repository.pullRequests.pageInfo.hasNextPage;
      cursor = result.repository.pullRequests.pageInfo.endCursor;
    }

    ghCore.info(
      `Auto update complete, ${updated} pull request(s) that point to base branch '${baseBranch}' were updated.`,
    );

    return updated;
  }

  private convertGraphQLPRToREST(
    pr: GraphQLPullRequestNode,
    owner: string,
  ): UpdateablePullRequest | null {
    // Check if headRef is null (can happen if PR comes from a deleted fork)
    if (!pr.headRef) {
      ghCore.warning(
        `PR #${pr.number} has null headRef (fork may have been deleted), skipping`,
      );
      return null;
    }

    return {
      number: pr.number,
      state: pr.state.toLowerCase(),
      merged: pr.merged,
      draft: pr.isDraft,
      labels: pr.labels.nodes,
      base: {
        ref: pr.baseRef.name,
        label: `${owner}:${pr.baseRef.name}`,
        sha: pr.baseRef.target.oid,
      },
      head: {
        ref: pr.headRef.name,
        label: pr.headRepository
          ? `${pr.headRepository.owner.login}:${pr.headRef.name}`
          : pr.headRef.name,
        sha: pr.headRef.target.oid,
        repo: pr.headRepository,
      },
    };
  }

  async update(
    sourceEventOwner: string,
    pull: PullRequest | UpdateablePullRequest,
  ): Promise<boolean> {
    const { ref } = pull.head;
    ghCore.info(`Evaluating pull request #${pull.number}...`);

    const prNeedsUpdate = await this.prNeedsUpdate(pull);
    if (!prNeedsUpdate) {
      return false;
    }

    const baseRef = pull.base.ref;
    const headRef = pull.head.ref;
    ghCore.info(
      `Updating branch '${ref}' on pull request #${pull.number} with changes from ref '${baseRef}'.`,
    );

    if (this.config.dryRun()) {
      ghCore.warning(
        `Would have merged ref '${headRef}' into ref '${baseRef}' but DRY_RUN was enabled.`,
      );
      return true;
    }

    if (pull.head.repo === null) {
      ghCore.error(
        `Could not determine repository for this pull request, skipping and continuing with remaining PRs`,
      );
      return false;
    }

    const mergeMsg = this.config.mergeMsg();
    const mergeOpts: MergeParameters = {
      owner: pull.head.repo.owner.login,
      repo: pull.head.repo.name,
      // We want to merge the base branch into this one.
      base: headRef,
      head: baseRef,
    };

    if (mergeMsg !== null && mergeMsg.length > 0) {
      mergeOpts.commit_message = mergeMsg;
    }

    try {
      return await this.merge(sourceEventOwner, pull.number, mergeOpts);
    } catch (e: unknown) {
      if (e instanceof Error) {
        ghCore.error(
          `Caught error running merge, skipping and continuing with remaining PRs`,
        );
        ghCore.setFailed(e);
      }
      return false;
    }
  }

  async prNeedsUpdate(
    pull: PullRequest | UpdateablePullRequest,
  ): Promise<boolean> {
    if (pull.merged === true) {
      ghCore.warning('Skipping pull request, already merged.');
      return false;
    }
    if (pull.state !== 'open') {
      ghCore.warning(
        `Skipping pull request, no longer open (current state: ${pull.state}).`,
      );
      return false;
    }
    if (!pull.head.repo) {
      ghCore.warning(
        `Skipping pull request, fork appears to have been deleted.`,
      );
      return false;
    }

    try {
      const { data: comparison } =
        await this.octokit.rest.repos.compareCommitsWithBasehead({
          owner: pull.head.repo.owner.login,
          repo: pull.head.repo.name,
          // This base->head, head->base logic is intentional, we want
          // to see what would happen if we merged the base into head not
          // vice-versa. This parameter expects the format {base}...{head}.
          basehead: `${pull.head.label}...${pull.base.label}`,
        });

      if (comparison.behind_by === 0) {
        ghCore.info('Skipping pull request, up-to-date with base branch.');
        return false;
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        ghCore.error(
          `Caught error trying to compare base with head: ${e.message}`,
        );
      }
      return false;
    }

    // First check if this PR has an excluded label on it and skip further
    // processing if so.
    const excludedLabels = this.config.excludedLabels();
    if (excludedLabels.length > 0) {
      for (const label of pull.labels) {
        if (label.name === undefined) {
          ghCore.debug(`Label name is undefined, continuing.`);
          continue;
        }
        if (excludedLabels.includes(label.name)) {
          ghCore.info(
            `Pull request has excluded label '${label.name}', skipping update.`,
          );
          return false;
        }
      }
    }

    const readyStateFilter = this.config.pullRequestReadyState();
    if (readyStateFilter !== 'all') {
      ghCore.info('Checking PR ready state');

      if (readyStateFilter === 'draft' && !pull.draft) {
        ghCore.info(
          'PR_READY_STATE=draft and pull request is not draft, skipping update.',
        );
        return false;
      }

      if (readyStateFilter === 'ready_for_review' && pull.draft) {
        ghCore.info(
          'PR_READY_STATE=ready_for_review and pull request is draft, skipping update.',
        );
        return false;
      }
    }

    const prFilter = this.config.pullRequestFilter();

    ghCore.info(
      `PR_FILTER=${prFilter}, checking if this PR's branch needs to be updated.`,
    );

    // If PR_FILTER=labelled, check that this PR has _any_ of the labels
    // specified in that configuration option.
    if (prFilter === 'labelled') {
      const labels = this.config.pullRequestLabels();
      if (labels.length === 0) {
        ghCore.warning(
          'Skipping pull request, no labels were defined (env var PR_LABELS is empty or not defined).',
        );
        return false;
      }
      ghCore.info(
        `Checking if this PR has a label in our list (${labels.join(', ')}).`,
      );

      if (pull.labels.length === 0) {
        ghCore.info('Skipping pull request, it has no labels.');
        return false;
      }

      for (const label of pull.labels) {
        if (label.name === undefined) {
          ghCore.debug(`Label name is undefined, continuing.`);
          continue;
        }

        if (labels.includes(label.name)) {
          ghCore.info(
            `Pull request has label '${label.name}' and PR branch is behind base branch.`,
          );
          return true;
        }
      }

      ghCore.info(
        'Pull request does not match any of the defined labels, skipping update.',
      );
      return false;
    }

    if (prFilter === 'protected') {
      ghCore.info('Checking if this PR is against a protected branch.');
      const { data: branch } = await this.octokit.rest.repos.getBranch({
        owner: pull.head.repo.owner.login,
        repo: pull.head.repo.name,
        branch: pull.base.ref,
      });

      if (branch.protected) {
        ghCore.info(
          'Pull request is against a protected branch and is behind base branch.',
        );
        return true;
      }

      ghCore.info(
        'Pull request is not against a protected branch, skipping update.',
      );
      return false;
    }

    if (prFilter === 'auto_merge') {
      ghCore.info('Checking if this PR has auto_merge enabled.');

      if (pull.auto_merge === null) {
        ghCore.info(
          'Pull request does not have auto_merge enabled, skipping update.',
        );

        return false;
      }

      ghCore.info(
        'Pull request has auto_merge enabled and is behind base branch.',
      );

      return true;
    }

    ghCore.info('All checks pass and PR branch is behind base branch.');
    return true;
  }

  async merge(
    sourceEventOwner: string,
    prNumber: number,
    mergeOpts: MergeParameters,
    // Allows for mocking in tests.
    setOutputFn: SetOutputFn = ghCore.setOutput,
  ): Promise<boolean> {
    const sleep = (timeMs: number) => {
      return new Promise((resolve) => {
        setTimeout(resolve, timeMs);
      });
    };

    const doMerge = async () => {
      const mergeResp: octokit.OctokitResponse<any> =
        await this.octokit.rest.repos.merge(mergeOpts);

      // See https://developer.github.com/v3/repos/merging/#perform-a-merge
      const { status } = mergeResp;
      if (status === 200 || status === 201) {
        ghCore.info(
          `Branch update successful, new branch HEAD: ${mergeResp.data.sha}.`,
        );
      } else if (status === 204) {
        ghCore.info(
          'Branch update not required, branch is already up-to-date.',
        );
      }

      return true;
    };

    const retryCount = this.config.retryCount();
    const retrySleep = this.config.retrySleep();
    const mergeConflictAction = this.config.mergeConflictAction();

    let retries = 0;

    while (true) {
      try {
        ghCore.info('Attempting branch update...');

        await doMerge();

        setOutputFn(Output.Conflicted, false);

        break;
      } catch (e: unknown) {
        if (e instanceof Error) {
          /**
           * If this update was against a fork and we got a 403 then it's
           * probably because we don't have access to it.
           */
          if (
            isRequestError(e) &&
            e.status === 403 &&
            sourceEventOwner !== mergeOpts.owner
          ) {
            ghCore.error(
              `Could not update pull request #${prNumber} due to an authorisation error. This is probably because this pull request is from a fork and the current token does not have write access to the forked repository. Error was: ${e.message}`,
            );

            setOutputFn(Output.Conflicted, false);

            return false;
          }

          if (e.message === 'Merge conflict') {
            setOutputFn(Output.Conflicted, true);

            if (mergeConflictAction === 'ignore') {
              // Ignore conflicts if configured to do so.
              ghCore.info('Merge conflict detected, skipping update.');
              return false;
            } else {
              // Else, throw an error so we don't continue retrying.
              ghCore.error('Merge conflict error trying to update branch');
              throw e;
            }
          }

          ghCore.error(`Caught error trying to update branch: ${e.message}`);
        }

        if (retries < retryCount) {
          ghCore.info(
            `Branch update failed, will retry in ${retrySleep}ms, retry #${retries} of ${retryCount}.`,
          );

          retries++;
          await sleep(retrySleep);
        } else {
          setOutputFn(Output.Conflicted, false);

          throw e;
        }
      }
    }

    return true;
  }
}
