// app/layout.tsx
import "./globals.css";
import Providers from "./providers";
import "@relayprotocol/relay-kit-ui/styles.css";

export const metadata = {
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
