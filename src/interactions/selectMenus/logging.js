import { handleLoggingMenuSelect } from '../../handlers/loggingButtons.js';

export default [
  {
    name: 'log_dash_menu',
    execute: handleLoggingMenuSelect,
  },
  {
    name: 'log_dash_routes',
    execute: handleLoggingMenuSelect,
  },
  {
    name: 'log_dash_routes_clear',
    execute: handleLoggingMenuSelect,
  },
];
