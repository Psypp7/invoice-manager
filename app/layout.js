import "./globals.css";
import AppShell from "../components/AppShell";

export const metadata = {
  title: "Invoice Manager",
  description:
    "Right Inventories invoice management system",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}