import { createRoot } from 'react-dom/client';
import { brand } from '../brand.ts';
import { PlannerApp } from './PlannerApp.tsx';
import './planner.css';
// Fonts of the alternative app "Backseat Racer" (self-hosted, SIL Open Font License).
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow-condensed/900-italic.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/700.css';

// Stint planner page (served by the team server under /planner/, opened from the app).
document.documentElement.dataset.brand = brand;
createRoot(document.getElementById('root')!).render(<PlannerApp />);
