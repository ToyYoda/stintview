import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { SetupPage } from './setup/SetupPage.tsx';
import './styles.css';
import { brand, brandName } from './brand.ts';
// Fonts of the alternative app "Backseat Racer" (self-hosted, SIL Open Font License).
import '@fontsource/barlow-condensed/600-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow-condensed/900-italic.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/700.css';

// Name, logo and colours of the app this page belongs to (styles: [data-brand="backseat"]).
document.documentElement.dataset.brand = brand;
document.title = `${brandName} Overlay`;

// The setup window doesn't need the telemetry feed, so it gets its own root component.
const isSetup = location.hash.startsWith('#/setup');
createRoot(document.getElementById('root')!).render(isSetup ? <SetupPage /> : <App />);
