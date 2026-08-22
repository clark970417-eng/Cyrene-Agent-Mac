export type ConnectionState = "connected" | "pending" | "error";

export interface ConnectionStatusItem {
  id: string;
  name: string;
  detail: string;
  icon: string;
  state: ConnectionState;
  label: string;
}
