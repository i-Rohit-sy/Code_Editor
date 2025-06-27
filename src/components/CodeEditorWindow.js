import React, { useEffect, useRef, useCallback, useState } from "react";

import Editor from "@monaco-editor/react";
import { useCollaboration } from "../contexts/CollaborationContext";
import { defineTheme } from "../lib/defineTheme";
import { languageOptions } from "../constants/languageOptions";

const CodeEditorWindow = ({ onChange, language, code, theme }) => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const {
    isCollaborating,
    sessionId,
    updateCode,
    updateCursorPosition,
    remoteCursors,
    socket,
    users,
  } = useCollaboration();

  // Store decorations for remote cursors and edits
  const decorationsRef = useRef({});
  const editDecorationRef = useRef({});
  // Keep track of last sent code to avoid duplicate updates
  const lastSentCodeRef = useRef(code);
  // Flag to ignore local changes while applying remote change
  const ignoreChangeRef = useRef(false);
  // Active edit sections
  const [activeEdits, setActiveEdits] = useState({});
  // Timeout handles for edit highlights
  const editTimeoutsRef = useRef({});
  // Recent changes for displaying diffs
  const [recentChanges, setRecentChanges] = useState([]);
  // Track change display timeouts
  const changeTimeoutsRef = useRef([]);
  // VS Code-like editor settings
  const [editorSettings, setEditorSettings] = useState({
    minimap: false,
    wordWrap: "on",
    lineNumbers: "on",
    folding: false,
    fontSize: 14,
    tabSize: 2,
  });
  // Menu state
  const [activeMenu, setActiveMenu] = useState(null);
  const menuRef = useRef(null);

  // File input ref for opening files
  const fileInputRef = useRef(null);

  useEffect(() => {
    // Add click outside listener to close menus
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setActiveMenu(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    console.log("CodeEditorWindow language changed to:", language);

    // Apply VS Code Dark+ theme if not already set
    if (theme === "cobalt") {
      defineTheme("vs-dark").then((_) => {
        onChange("theme", "vs-dark");
      });
    }
  }, [language, theme, onChange]);

  // Clean up all timeouts when component unmounts
  useEffect(() => {
    return () => {
      // Clear edit timeouts
      Object.values(editTimeoutsRef.current).forEach((timeout) =>
        clearTimeout(timeout)
      );
      // Clear change display timeouts
      changeTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    };
  }, []);

  // Setup socket event listeners for code updates
  useEffect(() => {
    if (!socket || !isCollaborating) return;

    const handleCodeUpdated = ({ code: newCode, userId }) => {
      console.log("Received code update from:", userId);

      if (!editorRef.current) {
        console.warn("Editor ref not available when receiving code update");
        return;
      }

      // Only update if it's from another user and content is different
      const currentValue = editorRef.current.getValue();
      if (userId !== socket.id && currentValue !== newCode) {
        console.log("Applying remote code update...");

        // Detect which sections were changed
        const changes = detectCodeChanges(currentValue, newCode);
        if (changes.length > 0) {
          // Highlight the changes
          highlightChanges(changes, userId);

          // Add to recent changes for display in the panel
          const user = users.find((u) => u.id === userId) || { id: userId };
          changes.forEach((change) => {
            // Get the lines for display in diff panel
            const oldLines = currentValue
              .split("\n")
              .slice(change.startLine - 1, change.endLine);
            const newLines = newCode
              .split("\n")
              .slice(change.startLine - 1, change.endLine);

            // Create change object for display
            const changeInfo = {
              id: Date.now() + Math.random().toString(36).substr(2, 9),
              userId: userId,
              user: user,
              startLine: change.startLine,
              endLine: change.endLine,
              oldText: oldLines.join("\n"),
              newText: newLines.join("\n"),
              timestamp: new Date(),
              color: getUserColor(userId),
            };

            // Add to recent changes and limit to 5 most recent
            setRecentChanges((prev) => {
              const newChanges = [changeInfo, ...prev].slice(0, 5);
              return newChanges;
            });

            // Set timeout to remove from display after 15 seconds
            const timeout = setTimeout(() => {
              setRecentChanges((prev) =>
                prev.filter((c) => c.id !== changeInfo.id)
              );
            }, 15000);

            changeTimeoutsRef.current.push(timeout);
          });
        }

        // Set flag to ignore local change events while applying remote change
        ignoreChangeRef.current = true;

        // Save selection state and scroll position
        const selection = editorRef.current.getSelection();
        const scrollPosition = editorRef.current.getScrollPosition();

        // Update the code
        editorRef.current.setValue(newCode);

        // Restore selection and scroll position
        if (selection) {
          editorRef.current.setSelection(selection);
        }
        editorRef.current.setScrollPosition(scrollPosition);

        // Update lastSentCode to avoid echo
        lastSentCodeRef.current = newCode;

        // Update parent component
        onChange("code", newCode);

        // Reset ignore flag after a small delay to ensure the change event has fired
        setTimeout(() => {
          ignoreChangeRef.current = false;
        }, 10);
      }
    };

    // Listen for edit activity
    const handleEditActivity = ({ userId, lineNumber, endLineNumber }) => {
      if (userId !== socket.id) {
        const range = {
          startLine: lineNumber,
          endLine: endLineNumber || lineNumber,
        };

        // Update active edits
        setActiveEdits((prev) => ({
          ...prev,
          [userId]: range,
        }));

        // Apply highlight decoration
        applyEditHighlight(userId, range);

        // Clear previous timeout if exists
        if (editTimeoutsRef.current[userId]) {
          clearTimeout(editTimeoutsRef.current[userId]);
        }

        // Set timeout to remove highlight after 2 seconds
        editTimeoutsRef.current[userId] = setTimeout(() => {
          setActiveEdits((prev) => {
            const newEdits = { ...prev };
            delete newEdits[userId];
            return newEdits;
          });

          // Remove highlight decoration
          if (editDecorationRef.current[userId] && editorRef.current) {
            editorRef.current.deltaDecorations(
              editDecorationRef.current[userId],
              []
            );
            delete editDecorationRef.current[userId];
          }
        }, 2000);
      }
    };

    console.log("Setting up code-updated event listener");
    socket.on("code-updated", handleCodeUpdated);
    socket.on("edit-activity", handleEditActivity);

    return () => {
      console.log("Removing code-updated event listener");
      socket.off("code-updated", handleCodeUpdated);
      socket.off("edit-activity", handleEditActivity);

      // Clear all timeouts
      Object.values(editTimeoutsRef.current).forEach((timeout) =>
        clearTimeout(timeout)
      );
    };
  }, [socket, isCollaborating, onChange, users]);

  // Helper function to detect which lines were changed
  const detectCodeChanges = (oldCode, newCode) => {
    const oldLines = oldCode.split("\n");
    const newLines = newCode.split("\n");
    const changes = [];

    // Find different lines
    let i = 0;
    let j = 0;
    let startDiff = -1;

    while (i < oldLines.length || j < newLines.length) {
      if (
        i < oldLines.length &&
        j < newLines.length &&
        oldLines[i] === newLines[j]
      ) {
        if (startDiff !== -1) {
          changes.push({
            startLine: startDiff + 1, // Monaco editor is 1-indexed
            endLine: i, // The line before the match
          });
          startDiff = -1;
        }
        i++;
        j++;
      } else {
        if (startDiff === -1) {
          startDiff = i;
        }
        // Skip to next line in longer array
        if (
          j >= newLines.length ||
          (i < oldLines.length && oldLines[i].length < newLines[j].length)
        ) {
          i++;
        } else {
          j++;
        }
      }
    }

    // Add last diff if exists
    if (startDiff !== -1) {
      changes.push({
        startLine: startDiff + 1,
        endLine: Math.max(oldLines.length, newLines.length),
      });
    }

    return changes;
  };

  // Highlight changed sections
  const highlightChanges = (changes, userId) => {
    if (!editorRef.current || !monacoRef.current) return;

    const userColor = getUserColor(userId);

    // Remove previous decorations for this user
    if (editDecorationRef.current[userId]) {
      editorRef.current.deltaDecorations(editDecorationRef.current[userId], []);
    }

    // Apply edit highlights for the detected changes
    changes.forEach((change) => {
      applyEditHighlight(userId, {
        startLine: change.startLine,
        endLine: change.endLine,
      });
    });

    // Update active edits
    if (changes.length > 0) {
      const latestChange = changes[changes.length - 1];
      setActiveEdits((prev) => ({
        ...prev,
        [userId]: {
          startLine: latestChange.startLine,
          endLine: latestChange.endLine,
        },
      }));

      // Clear previous timeout if exists
      if (editTimeoutsRef.current[userId]) {
        clearTimeout(editTimeoutsRef.current[userId]);
      }

      // Set timeout to remove highlight after 2 seconds
      editTimeoutsRef.current[userId] = setTimeout(() => {
        setActiveEdits((prev) => {
          const newEdits = { ...prev };
          delete newEdits[userId];
          return newEdits;
        });

        // Remove highlight decoration
        if (editDecorationRef.current[userId] && editorRef.current) {
          editorRef.current.deltaDecorations(
            editDecorationRef.current[userId],
            []
          );
          delete editDecorationRef.current[userId];
        }
      }, 2000);
    }
  };

  // Apply edit highlight decoration
  const applyEditHighlight = (userId, range) => {
    if (!editorRef.current || !monacoRef.current) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const userColor = getUserColor(userId);

    // Find the user from users array to get display name
    const user = users.find((u) => u.id === userId);
    const displayName = user
      ? `User ${userId.substring(0, 5)}`
      : "Unknown user";

    // Create line decoration for edit highlight
    const decorations = [
      {
        range: new monaco.Range(range.startLine, 1, range.endLine, 1),
        options: {
          isWholeLine: true,
          className: `edit-highlight-${userId.substring(0, 5)}`,
          glyphMarginClassName: `edit-glyph-${userId.substring(0, 5)}`,
          linesDecorationsClassName: `edit-line-decoration-${userId.substring(
            0,
            5
          )}`,
          marginClassName: `edit-margin-${userId.substring(0, 5)}`,
          hoverMessage: { value: `${displayName} is editing this section` },
        },
      },
    ];

    // Apply decorations
    editDecorationRef.current[userId] = editor.deltaDecorations(
      editDecorationRef.current[userId] || [],
      decorations
    );

    // Add CSS for this specific user's edit highlight
    addEditHighlightStyle(userId.substring(0, 5), userColor);
  };

  // Add CSS for edit highlight
  const addEditHighlightStyle = (userId, color) => {
    const styleId = `edit-highlight-style-${userId}`;

    // Remove any existing style
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }

    // Add new style with semi-transparent background
    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      .edit-highlight-${userId} {
        background-color: ${color}20 !important; /* 20 = 12% opacity */
        border-left: 3px solid ${color} !important;
      }
      .edit-glyph-${userId}:before {
        content: '✎';
        color: ${color};
        margin-left: 5px;
      }
      .edit-line-decoration-${userId} {
        background-color: ${color} !important;
        width: 5px !important;
      }
      .edit-margin-${userId} {
        background-color: ${color}10 !important;
      }
    `;
    document.head.appendChild(style);
  };

  // Handle editor mount
  const handleEditorDidMount = (editor, monaco) => {
    console.log("Editor mounted");
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Set up VS Code-like keybindings
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      editor.getAction("actions.find").run();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
      editor.getAction("editor.action.startFindReplaceAction").run();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
      editor.getAction("editor.action.addSelectionToNextFindMatch").run();
    });

    // Listen for cursor position changes
    editor.onDidChangeCursorPosition((e) => {
      if (isCollaborating && !ignoreChangeRef.current) {
        const position = {
          lineNumber: e.position.lineNumber,
          column: e.position.column,
        };
        updateCursorPosition(position);
      }
    });

    // Add content change listener for real-time updates
    editor.onDidChangeModelContent((event) => {
      if (isCollaborating && sessionId && !ignoreChangeRef.current) {
        const currentContent = editor.getValue();
        // Only send if content has actually changed
        if (currentContent !== lastSentCodeRef.current) {
          console.log("Local change detected, sending update...");

          // Notify about current editing position
          const selection = editor.getSelection();
          if (selection) {
            const startLine = selection.startLineNumber;
            const endLine = selection.endLineNumber;

            // Emit edit activity for other users to see
            socket.emit("edit-activity", {
              sessionId,
              lineNumber: startLine,
              endLineNumber: endLine,
              userId: socket.id,
            });
          }

          lastSentCodeRef.current = currentContent;
          updateCode(currentContent);
          onChange("code", currentContent);

          // Trigger real-time status update
          if (window.updateCollaborationStatus) {
            window.updateCollaborationStatus();
          }
        }
      }
    });
  };

  // Update remote cursors when they change
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !isCollaborating) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Clear old decorations
    Object.values(decorationsRef.current).forEach((decorationIds) => {
      editor.deltaDecorations(decorationIds, []);
    });

    const newDecorations = {};

    // Add new decorations for each remote cursor
    Object.entries(remoteCursors).forEach(([userId, position]) => {
      if (!position) return;

      const userColor = getUserColor(userId);

      // Create cursor decoration
      const cursorDecoration = {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column + 1
        ),
        options: {
          className: "remote-cursor",
          inlineClassName: "remote-cursor-inline",
          hoverMessage: { value: `User ${userId.substring(0, 5)}` },
          zIndex: 1,
          before: {
            content: "|",
            inlineClassName: `remote-cursor-before remote-cursor-${userId.substring(
              0,
              5
            )}`,
          },
        },
      };

      // Apply cursor decorations
      const decorationIds = editor.deltaDecorations([], [cursorDecoration]);
      newDecorations[userId] = decorationIds;

      // Add CSS for this specific user
      addCursorStyle(userId.substring(0, 5), userColor);
    });

    decorationsRef.current = newDecorations;
  }, [remoteCursors, isCollaborating, users]);

  // Helper to get a user's color
  const getUserColor = (userId) => {
    // This is a simple hash function to generate consistent colors
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`;
  };

  // Add CSS for cursor colors
  const addCursorStyle = (userId, color) => {
    const styleId = `cursor-style-${userId}`;

    // Remove any existing style
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }

    // Add new style
    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      .remote-cursor-${userId} {
        background-color: ${color} !important;
        color: white !important;
        width: 2px !important;
        margin-left: -1px;
      }
    `;
    document.head.appendChild(style);
  };

  // This is now only used for initial value and external changes
  const handleEditorChange = (value) => {
    // Skip if we're applying a remote change
    if (ignoreChangeRef.current) return;

    // Only process if not from the content change listener
    if (value !== lastSentCodeRef.current) {
      onChange("code", value);
      lastSentCodeRef.current = value;
    }
  };

  // Handle editor settings change
  const toggleEditorSetting = (setting) => {
    setEditorSettings((prev) => {
      const newSettings = { ...prev };

      if (setting === "wordWrap") {
        newSettings.wordWrap = prev.wordWrap === "on" ? "off" : "on";
      } else if (typeof prev[setting] === "boolean") {
        newSettings[setting] = !prev[setting];
      }

      // Apply settings to editor if it's mounted
      if (editorRef.current) {
        const editor = editorRef.current;

        if (setting === "minimap") {
          editor.updateOptions({ minimap: { enabled: newSettings.minimap } });
        } else if (setting === "folding") {
          editor.updateOptions({ folding: newSettings.folding });
        } else if (setting === "wordWrap") {
          editor.updateOptions({ wordWrap: newSettings.wordWrap });
        } else if (setting === "lineNumbers") {
          editor.updateOptions({ lineNumbers: newSettings.lineNumbers });
        }
      }

      return newSettings;
    });
  };

  // Font size adjustments
  const adjustFontSize = (delta) => {
    setEditorSettings((prev) => {
      const newFontSize = Math.max(8, Math.min(24, prev.fontSize + delta));

      // Apply to editor if mounted
      if (editorRef.current) {
        editorRef.current.updateOptions({ fontSize: newFontSize });
      }

      return { ...prev, fontSize: newFontSize };
    });
  };

  // Render active editors information
  const renderActiveEditors = () => {
    if (!isCollaborating || Object.keys(activeEdits).length === 0) return null;

    return (
      <div className="absolute bottom-2 left-2 z-10 bg-gray-800 bg-opacity-75 rounded-md p-2 text-xs text-white">
        <div className="font-bold mb-1">Active Editors:</div>
        {Object.entries(activeEdits).map(([userId, range]) => {
          const userColor = getUserColor(userId);
          const user = users.find((u) => u.id === userId);
          const displayName = user
            ? `User ${userId.substring(0, 5)}`
            : "Unknown";
          const lineInfo =
            range.startLine === range.endLine
              ? `Line ${range.startLine}`
              : `Lines ${range.startLine}-${range.endLine}`;

          return (
            <div key={userId} className="flex items-center gap-1 mb-1">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: userColor }}
              ></div>
              <span>
                {displayName}: {lineInfo}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // Render recent changes panel
  const renderRecentChangesPanel = () => {
    if (!isCollaborating || recentChanges.length === 0) return null;

    const formatTimestamp = (timestamp) => {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    };

    // Helper to show diff
    const renderDiff = (oldText, newText) => {
      const oldLines = oldText.split("\n");
      const newLines = newText.split("\n");

      // Simple line-by-line diff (not comparing characters)
      return (
        <div className="diff-container mt-1 max-h-20 overflow-y-auto text-xs font-mono">
          {newLines.map((line, index) => {
            const oldLine = oldLines[index] || "";
            const isChanged = line !== oldLine;

            return (
              <div
                key={index}
                className={`diff-line ${isChanged ? "diff-changed" : ""}`}
              >
                {isChanged ? (
                  <>
                    <div className="diff-old bg-red-900 bg-opacity-30 line-through whitespace-pre-wrap overflow-hidden text-ellipsis">
                      {oldLine || " "}
                    </div>
                    <div className="diff-new bg-green-900 bg-opacity-30 whitespace-pre-wrap overflow-hidden text-ellipsis">
                      {line || " "}
                    </div>
                  </>
                ) : (
                  <div className="diff-unchanged whitespace-pre-wrap overflow-hidden text-ellipsis">
                    {line}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    };

    return (
      <div className="absolute top-8 right-2 z-10 bg-gray-800 bg-opacity-90 rounded-md p-2 text-xs text-white w-72 max-h-[60vh] overflow-y-auto edit-activity-panel">
        <div className="font-bold mb-2 flex justify-between items-center">
          <span>Recent Changes</span>
          <button
            onClick={() => setRecentChanges([])}
            className="text-gray-400 hover:text-white text-xs px-1 py-0.5 rounded"
          >
            Clear
          </button>
        </div>
        {recentChanges.map((change) => {
          const userColor = change.color;
          const displayName = `User ${change.userId.substring(0, 5)}`;
          const lineInfo =
            change.startLine === change.endLine
              ? `Line ${change.startLine}`
              : `Lines ${change.startLine}-${change.endLine}`;

          return (
            <div key={change.id} className="mb-3 pb-3 border-b border-gray-700">
              <div className="flex items-center gap-1 mb-1">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: userColor }}
                ></div>
                <span className="font-medium">{displayName}</span>
                <span className="text-gray-400 ml-auto">
                  {formatTimestamp(change.timestamp)}
                </span>
              </div>
              <div className="text-gray-300">{lineInfo}</div>
              {renderDiff(change.oldText, change.newText)}
            </div>
          );
        })}
      </div>
    );
  };

  // Render editor status bar (VS Code style)
  const renderStatusBar = () => {
    return (
      <div className="flex items-center bg-gray-700 text-white text-xs justify-between px-2 py-1">
        <div className="flex items-center gap-4">
          <div>
            Ln {editorRef.current?.getPosition()?.lineNumber || 1}, Col{" "}
            {editorRef.current?.getPosition()?.column || 1}
          </div>
          <div
            className="cursor-pointer hover:bg-gray-600 px-2 py-0.5 rounded"
            onClick={() => toggleEditorSetting("lineNumbers")}
          >
            {editorSettings.lineNumbers === "on"
              ? "Line Numbers: On"
              : "Line Numbers: Off"}
          </div>
          <div
            className="cursor-pointer hover:bg-gray-600 px-2 py-0.5 rounded"
            onClick={() => toggleEditorSetting("wordWrap")}
          >
            Wrap: {editorSettings.wordWrap === "on" ? "On" : "Off"}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="hover:bg-gray-600 px-1 rounded"
              onClick={() => adjustFontSize(-1)}
            >
              -
            </button>
            <span>Font: {editorSettings.fontSize}px</span>
            <button
              className="hover:bg-gray-600 px-1 rounded"
              onClick={() => adjustFontSize(1)}
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div
            className="cursor-pointer hover:bg-gray-600 px-2 py-0.5 rounded"
            onClick={() => toggleEditorSetting("minimap")}
          >
            Minimap: {editorSettings.minimap ? "On" : "Off"}
          </div>
          <div
            className="cursor-pointer hover:bg-gray-600 px-2 py-0.5 rounded"
            onClick={() => toggleEditorSetting("folding")}
          >
            Folding: {editorSettings.folding ? "On" : "Off"}
          </div>
          <div>{language || "javascript"}</div>
        </div>
      </div>
    );
  };

  // Menu functionality
  const handleMenuClick = (menuName) => {
    setActiveMenu(activeMenu === menuName ? null : menuName);
  };

  const executeMenuAction = (action) => {
    if (!editorRef.current || !monacoRef.current) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Close menu
    setActiveMenu(null);

    switch (action) {
      // File menu actions
      case "new_file":
        // Confirm before creating new file if there are changes
        if (code.trim() !== "") {
          if (
            window.confirm("Create new file? Any unsaved changes will be lost.")
          ) {
            onChange("code", "");
          }
        } else {
          onChange("code", "");
        }
        break;
      case "open_file":
        // Trigger file input click
        if (fileInputRef.current) {
          fileInputRef.current.click();
        }
        break;
      case "save":
        // In a real app, this would save to the server
        // For demo purposes, we'll download the file
        const blob = new Blob([editor.getValue()], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "code." + (language || "js");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        break;
      case "save_as":
        // Similar to save but prompt for name
        const fileName = prompt(
          "Enter file name:",
          "code." + (language || "js")
        );
        if (fileName) {
          const saveBlob = new Blob([editor.getValue()], {
            type: "text/plain",
          });
          const saveUrl = URL.createObjectURL(saveBlob);
          const link = document.createElement("a");
          link.href = saveUrl;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(saveUrl);
        }
        break;
      case "preferences":
        // Show editor settings dialog
        const settingsDialog = document.createElement("div");
        settingsDialog.className = "vs-settings-dialog";
        settingsDialog.innerHTML = `
          <div class="vs-settings-dialog-content">
            <h3>Editor Settings</h3>
            <div class="vs-settings-item">
              <label>Font Size: ${editorSettings.fontSize}px</label>
              <div class="vs-settings-buttons">
                <button class="vs-settings-btn" data-action="fontSize" data-value="-1">-</button>
                <button class="vs-settings-btn" data-action="fontSize" data-value="1">+</button>
              </div>
            </div>
            <div class="vs-settings-item">
              <label>Word Wrap</label>
              <div class="vs-settings-buttons">
                <button class="vs-settings-btn ${
                  editorSettings.wordWrap === "on" ? "active" : ""
                }" data-action="wordWrap">Toggle</button>
              </div>
            </div>
            <div class="vs-settings-item">
              <label>Line Numbers</label>
              <div class="vs-settings-buttons">
                <button class="vs-settings-btn ${
                  editorSettings.lineNumbers === "on" ? "active" : ""
                }" data-action="lineNumbers">Toggle</button>
              </div>
            </div>
            <div class="vs-settings-item">
              <label>Minimap</label>
              <div class="vs-settings-buttons">
                <button class="vs-settings-btn ${
                  editorSettings.minimap ? "active" : ""
                }" data-action="minimap">Toggle</button>
              </div>
            </div>
            <div class="vs-settings-close">
              <button>Close</button>
            </div>
          </div>
        `;
        document.body.appendChild(settingsDialog);

        // Add click handlers
        settingsDialog
          .querySelector(".vs-settings-close button")
          .addEventListener("click", () => {
            document.body.removeChild(settingsDialog);
          });

        settingsDialog.querySelectorAll(".vs-settings-btn").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const action = e.target.getAttribute("data-action");
            if (action === "fontSize") {
              const value = parseInt(e.target.getAttribute("data-value"));
              adjustFontSize(value);
              e.target
                .closest(".vs-settings-item")
                .querySelector("label").textContent = `Font Size: ${
                editorSettings.fontSize + value
              }px`;
            } else {
              toggleEditorSetting(action);
              e.target.classList.toggle("active");
            }
          });
        });

        break;

      // Edit menu actions
      case "undo":
        editor.getModel().undo();
        break;
      case "redo":
        editor.getModel().redo();
        break;
      case "cut":
        document.execCommand("cut");
        break;
      case "copy":
        document.execCommand("copy");
        break;
      case "paste":
        document.execCommand("paste");
        break;
      case "find":
        editor.getAction("actions.find").run();
        break;
      case "replace":
        editor.getAction("editor.action.startFindReplaceAction").run();
        break;

      // Selection menu actions
      case "select_all":
        editor.getAction("editor.action.selectAll").run();
        break;
      case "expand_selection":
        editor.getAction("editor.action.smartSelect.expand").run();
        break;
      case "shrink_selection":
        editor.getAction("editor.action.smartSelect.shrink").run();
        break;
      case "multi_cursor_above":
        editor.getAction("editor.action.insertCursorAbove").run();
        break;
      case "multi_cursor_below":
        editor.getAction("editor.action.insertCursorBelow").run();
        break;

      // View menu actions
      case "toggle_word_wrap":
        toggleEditorSetting("wordWrap");
        break;
      case "toggle_minimap":
        toggleEditorSetting("minimap");
        break;
      case "toggle_line_numbers":
        toggleEditorSetting("lineNumbers");
        break;
      case "toggle_folding":
        toggleEditorSetting("folding");
        break;
      case "zoom_in":
        adjustFontSize(1);
        break;
      case "zoom_out":
        adjustFontSize(-1);
        break;
      default:
        console.log(`Action not implemented: ${action}`);
    }
  };

  // Handle file open
  const handleFileOpen = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      onChange("code", content);

      // Try to detect language from file extension
      const extension = file.name.split(".").pop().toLowerCase();
      const languageMap = {
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        py: "python",
        java: "java",
        c: "c",
        cpp: "cpp",
        cs: "csharp",
        html: "html",
        css: "css",
        json: "json",
        md: "markdown",
        sql: "sql",
        php: "php",
        rb: "ruby",
        go: "go",
      };

      if (languageMap[extension]) {
        // Find language option and update
        const langOption = languageOptions.find(
          (opt) => opt.value === languageMap[extension]
        );

        if (langOption) {
          onChange("language", langOption);
        }
      }
    };
    reader.readAsText(file);

    // Reset file input
    e.target.value = "";
  };

  // Render VS Code-like menu bar
  const renderMenuBar = () => {
    return (
      <div className="vs-menu-bar" ref={menuRef}>
        <div className="vs-menu-items">
          <div
            className={`vs-menu-item ${activeMenu === "file" ? "active" : ""}`}
            onClick={() => handleMenuClick("file")}
          >
            File
            {activeMenu === "file" && (
              <div className="vs-menu-dropdown">
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("new_file")}
                >
                  <span>New File</span>
                  <span className="vs-menu-shortcut">Ctrl+N</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("open_file")}
                >
                  <span>Open File...</span>
                  <span className="vs-menu-shortcut">Ctrl+O</span>
                </div>
                <div className="vs-menu-separator"></div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("save")}
                >
                  <span>Save</span>
                  <span className="vs-menu-shortcut">Ctrl+S</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("save_as")}
                >
                  <span>Save As...</span>
                  <span className="vs-menu-shortcut">Ctrl+Shift+S</span>
                </div>
                <div className="vs-menu-separator"></div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("preferences")}
                >
                  <span>Preferences</span>
                </div>
              </div>
            )}
          </div>

          <div
            className={`vs-menu-item ${activeMenu === "edit" ? "active" : ""}`}
            onClick={() => handleMenuClick("edit")}
          >
            Edit
            {activeMenu === "edit" && (
              <div className="vs-menu-dropdown">
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("undo")}
                >
                  <span>Undo</span>
                  <span className="vs-menu-shortcut">Ctrl+Z</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("redo")}
                >
                  <span>Redo</span>
                  <span className="vs-menu-shortcut">Ctrl+Y</span>
                </div>
                <div className="vs-menu-separator"></div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("cut")}
                >
                  <span>Cut</span>
                  <span className="vs-menu-shortcut">Ctrl+X</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("copy")}
                >
                  <span>Copy</span>
                  <span className="vs-menu-shortcut">Ctrl+C</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("paste")}
                >
                  <span>Paste</span>
                  <span className="vs-menu-shortcut">Ctrl+V</span>
                </div>
                <div className="vs-menu-separator"></div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("find")}
                >
                  <span>Find</span>
                  <span className="vs-menu-shortcut">Ctrl+F</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("replace")}
                >
                  <span>Replace</span>
                  <span className="vs-menu-shortcut">Ctrl+H</span>
                </div>
              </div>
            )}
          </div>

          <div
            className={`vs-menu-item ${
              activeMenu === "selection" ? "active" : ""
            }`}
            onClick={() => handleMenuClick("selection")}
          >
            Selection
            {activeMenu === "selection" && (
              <div className="vs-menu-dropdown">
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("select_all")}
                >
                  <span>Select All</span>
                  <span className="vs-menu-shortcut">Ctrl+A</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("expand_selection")}
                >
                  <span>Expand Selection</span>
                  <span className="vs-menu-shortcut">Shift+Alt+→</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("shrink_selection")}
                >
                  <span>Shrink Selection</span>
                  <span className="vs-menu-shortcut">Shift+Alt+←</span>
                </div>
                <div className="vs-menu-separator"></div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("multi_cursor_above")}
                >
                  <span>Add Cursor Above</span>
                  <span className="vs-menu-shortcut">Alt+Shift+↑</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("multi_cursor_below")}
                >
                  <span>Add Cursor Below</span>
                  <span className="vs-menu-shortcut">Alt+Shift+↓</span>
                </div>
              </div>
            )}
          </div>

          <div
            className={`vs-menu-item ${activeMenu === "view" ? "active" : ""}`}
            onClick={() => handleMenuClick("view")}
          >
            View
            {activeMenu === "view" && (
              <div className="vs-menu-dropdown">
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("toggle_word_wrap")}
                >
                  <span>Toggle Word Wrap</span>
                  <span className="vs-menu-shortcut">Alt+Z</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("toggle_minimap")}
                >
                  <span>Toggle Minimap</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("toggle_line_numbers")}
                >
                  <span>Toggle Line Numbers</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("toggle_folding")}
                >
                  <span>Toggle Code Folding</span>
                </div>
                <div className="vs-menu-separator"></div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("zoom_in")}
                >
                  <span>Zoom In</span>
                  <span className="vs-menu-shortcut">Ctrl++</span>
                </div>
                <div
                  className="vs-menu-option"
                  onClick={() => executeMenuAction("zoom_out")}
                >
                  <span>Zoom Out</span>
                  <span className="vs-menu-shortcut">Ctrl+-</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="overlay rounded-md overflow-hidden w-full h-full shadow-4xl relative flex flex-col">
      {isCollaborating && (
        <div className="absolute top-2 right-2 px-2 py-1 bg-green-500 text-white text-xs rounded-md z-10">
          Real-time Collaboration
        </div>
      )}

      {renderMenuBar()}

      {renderActiveEditors()}
      {renderRecentChangesPanel()}

      {/* Hidden file input for opening files */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileOpen}
        accept=".js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.html,.css,.json,.md,.sql,.php,.rb,.go"
      />

      <div className="flex-grow relative">
        <Editor
          height="85vh"
          width={`100%`}
          language={language || "javascript"}
          value={code}
          theme={theme}
          defaultValue="// some comment"
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            fontSize: editorSettings.fontSize,
            scrollBeyondLastLine: false,
            wordWrap: editorSettings.wordWrap,
            minimap: { enabled: editorSettings.minimap },
            folding: editorSettings.folding,
            lineNumbers: editorSettings.lineNumbers,
            lineNumbersMinChars: 4,
            automaticLayout: true,
            tabSize: editorSettings.tabSize,
            glyphMargin: false,
            contextmenu: true,
            guides: {
              indentation: true,
              bracketPairs: true,
            },
            bracketPairColorization: {
              enabled: true,
            },
            renderWhitespace: "selection",
            renderControlCharacters: true,
            autoIndent: "full",
            formatOnPaste: true,
            formatOnType: true,
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            scrollbar: {
              vertical: "visible",
              horizontal: "visible",
              verticalScrollbarSize: 12,
              horizontalScrollbarSize: 12,
            },
            lineDecorationsWidth: 10,
            renderLineHighlight: "all",
            renderLineHighlightOnlyWhenFocus: false,
            occurrencesHighlight: true,
            selectionHighlight: true,
            colorDecorators: true,
            suggest: {
              showMethods: true,
              showFunctions: true,
              showConstructors: true,
              showFields: true,
              showVariables: true,
              showClasses: true,
              showStructs: true,
              showInterfaces: true,
              showModules: true,
              showProperties: true,
              showEvents: true,
              showOperators: true,
              showUnits: true,
              showValues: true,
              showConstants: true,
              showEnums: true,
              showEnumMembers: true,
              showKeywords: true,
              showWords: true,
              showColors: true,
              showFiles: true,
              showReferences: true,
              showFolders: true,
              showTypeParameters: true,
              showIssues: true,
              showUsers: true,
              showSnippets: true,
            },
          }}
        />
      </div>
      {renderStatusBar()}
    </div>
  );
};

export default CodeEditorWindow;
