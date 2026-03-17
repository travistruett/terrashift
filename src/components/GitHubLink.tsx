"use client";

import { Tooltip } from "@mantine/core";

export default function GitHubLink() {
  return (
    <Tooltip label="View source" position="left" offset={8}>
      <a
        href="https://github.com/travistruett/terrashift"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View source on GitHub"
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          zIndex: 10,
          color: "rgba(255, 255, 255, 0.5)",
          display: "flex",
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5" />
        </svg>
      </a>
    </Tooltip>
  );
}
