// A single main landmark for the public pages in this folder, so keyboard and screen-reader users can jump straight to the content (WCAG 2.4.1 / best practice landmark-one-main).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main>{children}</main>
}
