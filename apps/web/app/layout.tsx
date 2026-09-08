import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Frame — Browser proof of concept',description:'Capture your Android screen and device audio locally over USB.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
