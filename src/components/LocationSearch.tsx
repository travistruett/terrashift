"use client";

import { useState, useEffect } from "react";
import { TextInput, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { searchLocation, type GeoResult } from "@/actions/geocode";
import { useSnowfallStore } from "@/stores/snowfall";

export default function LocationSearch() {
  const [query, setQuery] = useState("");
  const [debounced] = useDebouncedValue(query, 400);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stale = false;
    if (debounced.length < 3) {
      // Defer state update to avoid synchronous set-state-in-effect
      queueMicrotask(() => {
        if (!stale) setResults([]);
      });
      return () => { stale = true; };
    }
    searchLocation(debounced).then((r) => {
      if (!stale) {
        setResults(r);
        setOpen(r.length > 0);
      }
    });
    return () => {
      stale = true;
    };
  }, [debounced]);

  function handleSelect(result: GeoResult) {
    setQuery(result.displayName.split(",")[0]);
    setOpen(false);
    setResults([]);
    const store = useSnowfallStore.getState();
    store.setPin(result.lat, result.lng);
    store.setFlyTo(result.lat, result.lng);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && results.length > 0) {
      handleSelect(results[0]);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div style={{ position: "absolute", top: 24, left: 24, zIndex: 10, width: 320 }}>
      <TextInput
        placeholder="Search location..."
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setOpen(false)}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        leftSection={
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        }
        styles={{
          input: {
            backgroundColor: "rgba(26, 27, 30, 0.85)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
          },
        }}
      />
      {open && results.length > 0 && (
        <Paper
          shadow="md"
          p={4}
          mt={4}
          style={{
            backgroundColor: "rgba(26, 27, 30, 0.95)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <Stack gap={0}>
            {results.map((r) => (
              <UnstyledButton
                key={`${r.lat},${r.lng}`}
                onMouseDown={() => handleSelect(r)}
                p="xs"
                w="100%"
              >
                <Text size="sm" lineClamp={1}>
                  {r.displayName}
                </Text>
              </UnstyledButton>
            ))}
            <Text size="xs" c="dimmed" ta="right" px="xs" py={4}>
              OpenStreetMap
            </Text>
          </Stack>
        </Paper>
      )}
    </div>
  );
}
