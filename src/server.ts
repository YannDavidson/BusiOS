import { createApp } from './app.js';
import { assertProductionConfig, config } from './config.js';
import { GeminiDiego } from './diego.js';
import { MultiAgentRuntime } from './team-runtime.js';
import { Orchestrator } from './orchestrator.js';
import { createStore } from './store.js';

assertProductionConfig();
const store = createStore();
const diego = new GeminiDiego();
const app = createApp(new Orchestrator(store, diego, new MultiAgentRuntime(store, diego)));
app.listen(config.PORT, () => console.log(`BusiOS listening on :${config.PORT}`));
