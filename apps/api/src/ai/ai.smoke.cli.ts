import { runAiSmoke } from './ai.smoke';

void runAiSmoke().then((result) => {
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
  process.exit(result.exitCode);
});
