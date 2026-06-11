import { join } from 'node:path';

// The visible faculty-home directory name (the agent/ layout).
export const HOME = 'agent';
export const home = (root) => join(root, HOME);
