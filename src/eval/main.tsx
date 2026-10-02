import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import EvalApp from './EvalApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EvalApp />
  </StrictMode>,
);
