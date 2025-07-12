import { ApexLogParser } from './ApexLogParser';
import * as path from 'path';

/**
 * Simple command-line driver to parse a Salesforce debug log with ApexLogParser
 * and print the resulting JSON to stdout.
 *
 * Usage:
 *   npx ts-node src/utils/runParser.ts /path/to/debug.log
 *   # or after compiling:
 *   node dist/utils/runParser.js /path/to/debug.log
 */
async function main(): Promise<void> {
  const [, , logPathArg] = process.argv;

  if (!logPathArg) {
    console.error('Usage: ts-node src/utils/runParser.ts <logFilePath>');
    process.exit(1);
  }

  const logPath = path.resolve(logPathArg);
  const parser = new ApexLogParser();

  try {
    const result = await parser.parseFile(logPath);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`Failed to parse log: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// Execute when run directly via node / ts-node
/* istanbul ignore if */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}

