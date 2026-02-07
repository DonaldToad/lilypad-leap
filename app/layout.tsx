import type { Metadata } from "next";
import "./globals.css";
import "@relayprotocol/relay-kit-ui/styles.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Lilypad Leap",
  description: "Donald Toad Coin • Lilypad Leap",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
