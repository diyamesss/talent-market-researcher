import "./globals.css";

export const metadata = {
  title: "Talent Market Researcher",
  description: "Live, source-cited talent market reports from a job description",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
