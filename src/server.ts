import { createApp } from './app.js';
import { assertProductionConfig, config } from './config.js';
import { GeminiDiego } from './diego.js';
import { Orchestrator } from './orchestrator.js';
import { createStore } from './store.js';

assertProductionConfig();
const app = createApp(new Orchestrator(createStore(), new GeminiDiego()));
app.listen(config.PORT, () => console.log(`BusiOS listening on :${config.PORT}`));
