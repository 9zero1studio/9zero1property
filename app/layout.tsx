import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "9Zero1Property",
  description: "ระบบสมาชิกและสะสมคะแนน 9Zero1Property",
  applicationName: "9Zero1Property",
  manifest: "/manifest.json"
};
export const viewport: Viewport = { themeColor: "#090909", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
