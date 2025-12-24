import { WebhookEvent } from '@octokit/webhooks-types';
import { AutoUpdater } from '../src/autoupdater';
import { ConfigLoader } from '../src/config-loader';

export class Router {
  updater: AutoUpdater;

  constructor(config: ConfigLoader, eventData: WebhookEvent) {
    this.updater = new AutoUpdater(config, eventData);
  }

  /**
   * Route a Github event to a handler.
   *
   * @param eventName
   * @returns {Promise<void>}
   */
  async route(eventName: string | undefined): Promise<void> {
    if (eventName === 'pull_request' || eventName === 'pull_request_target') {
      await this.updater.handlePullRequest();
    } else if (eventName === 'push') {
      await this.updater.handlePush();
    } else if (eventName === 'workflow_run') {
      await this.updater.handleWorkflowRun();
    } else if (eventName === 'workflow_dispatch') {
      await this.updater.handleWorkflowDispatch();
    } else if (eventName === 'schedule') {
      await this.updater.handleSchedule();
    } else {
      throw new Error(
        `Unknown event type '${eventName}', only 'push', 'pull_request', 'pull_request_target', 'workflow_run', 'workflow_dispatch', and 'schedule' are supported.`,
      );
    }
  }
}
