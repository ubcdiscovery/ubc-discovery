import { Navigate } from "react-router";

export default function AdminIndex() {
  return <Navigate to="/admin/events" replace />;
}
