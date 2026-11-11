import React from "react";
import ReactDOM from "react-dom/client";
import { AllCommunityModule } from "ag-grid-community";
import { AgGridProvider } from "ag-grid-react";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AgGridProvider modules={[AllCommunityModule]}>
      <App />
    </AgGridProvider>
  </React.StrictMode>,
);
