import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { SetupPage } from './setup/SetupPage.tsx';
import './styles.css';

// The setup window doesn't need the telemetry feed, so it gets its own root component.
const isSetup = location.hash.startsWith('#/setup');
createRoot(document.getElementById('root')!).render(isSetup ? <SetupPage /> : <App />);
