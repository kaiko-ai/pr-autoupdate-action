export class ConfigLoader {
  env: NodeJS.ProcessEnv;

  constructor() {
    this.env = process.env;
  }

  githubToken(): string {
    return this.getValue('GITHUB_TOKEN', true);
  }

  dryRun(): boolean {
    const val = this.getValue('DRY_RUN', false, 'false');
    return val === 'true';
  }

  /**
   * Whether a pull request must carry an approving review before its branch is
   * updated. Off by default, so existing configurations are unaffected.
   *
   * An approval is the signal that someone intends to merge. Waiting for it
   * avoids updating - and so re-running CI on - pull requests that are still
   * waiting to be looked at. Deliberately not "all checks are green": a check
   * can be pending because the branch is stale, and gating the update on it
   * would be circular. An approval never depends on how fresh the branch is.
   */
  requireApproval(): boolean {
    const val = this.getValue('REQUIRE_APPROVAL', false, 'false');
    return val === 'true';
  }

  pullRequestFilter(): string {
    // one of 'all', 'protected', 'labelled' or 'auto_merge'.
    return this.getValue('PR_FILTER', false, 'all');
  }

  pullRequestLabels(): Array<string> {
    const rawLabels = this.getValue('PR_LABELS', false, '').toString().trim();
    if (rawLabels === '') {
      return [];
    }
    return rawLabels.split(',').map((label: string) => label.trim());
  }

  excludedLabels(): Array<string> {
    const rawLabels = this.getValue('EXCLUDED_LABELS', false, '')
      .toString()
      .trim();
    if (rawLabels === '') {
      return [];
    }
    return rawLabels.split(',').map((label: string) => label.trim());
  }

  mergeMsg(): string {
    const msg = this.getValue('MERGE_MSG', false, '').toString().trim();
    return msg === '' ? null : msg;
  }

  conflictMsg(): string {
    const msg = this.getValue('CONFLICT_MSG', false, '').toString().trim();
    return msg === '' ? null : msg;
  }

  retryCount(): number {
    return parseInt(this.getValue('RETRY_COUNT', false, 5), 10);
  }

  retrySleep(): number {
    // In milliseconds.
    return parseInt(this.getValue('RETRY_SLEEP', false, 300), 10);
  }

  mergeConflictAction(): string {
    // one of 'fail' or 'ignore'.
    return this.getValue('MERGE_CONFLICT_ACTION', false, 'fail');
  }

  githubRef(): string {
    return this.getValue('GITHUB_REF', true, '');
  }

  githubRepository(): string {
    return this.getValue('GITHUB_REPOSITORY', true, '');
  }

  pullRequestReadyState(): string {
    return this.getValue('PR_READY_STATE', false, 'all');
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  getValue(key: string, required = false, defaultVal?: any): any {
    if (
      key in this.env &&
      this.env[key] !== null &&
      this.env[key] !== undefined
    ) {
      return this.env[key];
    }

    if (required) {
      throw new Error(
        `Environment variable '${key}' was not provided, please define it and try again.`,
      );
    }

    return defaultVal;
  }
}

export default new ConfigLoader();
