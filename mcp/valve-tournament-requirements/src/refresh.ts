import { formatStatus, getStatus } from "./tor.js";

const status = await getStatus(true);
console.log(formatStatus(status));

if (status.warning && !status.cached) {
  process.exit(1);
}
