import { BrowserRouter } from 'react-router-dom';
import { PrototypeContextProvider } from './PrototypeContext';
import { PrototypeRoutes } from './routes';

export function App() {
  return (
    <BrowserRouter>
      <PrototypeContextProvider>
        <PrototypeRoutes />
      </PrototypeContextProvider>
    </BrowserRouter>
  );
}
