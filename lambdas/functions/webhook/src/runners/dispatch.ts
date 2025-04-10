import { createChildLogger } from '@aws-github-runner/aws-powertools-util';
import { WorkflowJobEvent } from '@octokit/webhooks-types';

import { Response } from '../lambda';
import { RunnerMatcherConfig, sendActionRequest } from '../sqs';
import ValidationError from '../ValidationError';
import { ConfigDispatcher, ConfigWebhook } from '../ConfigLoader';

const logger = createChildLogger('handler');

export async function dispatch(
  event: WorkflowJobEvent,
  eventType: string,
  config: ConfigDispatcher | ConfigWebhook,
): Promise<Response> {
  validateRepoInAllowList(event, config);

  return await handleWorkflowJob(event, eventType, config.matcherConfig!);
}

function validateRepoInAllowList(event: WorkflowJobEvent, config: ConfigDispatcher) {
  const isGloballyAllowed =
    config.repositoryAllowList.length > 0 && !config.repositoryAllowList.includes(event.repository.full_name);

  const requestedCluster = event.workflow_job.labels[0];

  const clusterList = config.allowList[requestedCluster];

  const isClusterAllowed = clusterList && clusterList.length > 0 && !clusterList.includes(event.repository.full_name);

  if (isClusterAllowed) {
    logger.warn(`Repository ${event.repository.full_name} not in allow list`);
    // TODO: send a message to the queue to delete the workflow run
    // const payload: ActionRequestMessage = {
    //   id: event.workflow_job.id,
    //   repositoryName: event.repository.name,
    //   repositoryOwner: event.repository.owner.login,
    //   eventType: 'workflow_job',
    //   installationId: event.installation?.id ?? 0,
    //   repoOwnerType: event.repository.owner.type,
    // };
    // const url = 'https://api.github.com';
    // const client = await getOctokit(url, true, payload);
    // client.actions
    //   .deleteWorkflowRun({
    //     owner: event.repository.owner.login,
    //     repo: event.repository.name,
    //     run_id: event.workflow_job.run_id,
    //   })
    //   .catch((err) => {
    //     logger.error(`Failed to delete workflow run: ${err}`);
    //   });
    throw new ValidationError(403, `Repository ${event.repository.full_name} not in cluster allow list`);
  }
  if (isGloballyAllowed) {
    logger.info(`Received event from unauthorized repository ${event.repository.full_name}`);
    throw new ValidationError(403, `Received event from unauthorized repository ${event.repository.full_name}`);
  }
}

async function handleWorkflowJob(
  body: WorkflowJobEvent,
  githubEvent: string,
  matcherConfig: Array<RunnerMatcherConfig>,
): Promise<Response> {
  if (body.action === 'queued') {
    // sort the queuesConfig by order of matcher config exact match, with all true matches lined up ahead.
    matcherConfig.sort((a, b) => {
      return a.matcherConfig.exactMatch === b.matcherConfig.exactMatch ? 0 : a.matcherConfig.exactMatch ? -1 : 1;
    });
    for (const queue of matcherConfig) {
      if (canRunJob(body.workflow_job.labels, queue.matcherConfig.labelMatchers, queue.matcherConfig.exactMatch)) {
        await sendActionRequest({
          id: body.workflow_job.id,
          repositoryName: body.repository.name,
          repositoryOwner: body.repository.owner.login,
          eventType: githubEvent,
          installationId: body.installation?.id ?? 0,
          queueId: queue.id,
          repoOwnerType: body.repository.owner.type,
        });
        logger.info(`Successfully dispatched job for ${body.repository.full_name} to the queue ${queue.id}`);
        return {
          statusCode: 201,
          body: `Successfully queued job for ${body.repository.full_name} to the queue ${queue.id}`,
        };
      }
    }
    logger.warn(`Received event contains runner labels '${body.workflow_job.labels}' that are not accepted.`);
    return {
      statusCode: 202,
      body: `Received event contains runner labels '${body.workflow_job.labels}' that are not accepted.`,
    };
  }
  return {
    statusCode: 201,
    body: `Received not queued and will not be ignored.`,
  };
}

export function canRunJob(
  workflowJobLabels: string[],
  runnerLabelsMatchers: string[][],
  workflowLabelCheckAll: boolean,
): boolean {
  runnerLabelsMatchers = runnerLabelsMatchers.map((runnerLabel) => {
    return runnerLabel.map((label) => label.toLowerCase());
  });
  const matchLabels = workflowLabelCheckAll
    ? runnerLabelsMatchers.some((rl) => workflowJobLabels.every((wl) => rl.includes(wl.toLowerCase())))
    : runnerLabelsMatchers.some((rl) => workflowJobLabels.some((wl) => rl.includes(wl.toLowerCase())));
  const match = workflowJobLabels.length === 0 ? !matchLabels : matchLabels;

  logger.debug(
    `Received workflow job event with labels: '${JSON.stringify(workflowJobLabels)}'. The event does ${
      match ? '' : 'NOT '
    }match the runner labels: '${Array.from(runnerLabelsMatchers).join(',')}'`,
  );
  return match;
}
