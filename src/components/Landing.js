import React, { useEffect, useState, useCallback } from "react";
import CodeEditorWindow from "./CodeEditorWindow";
import axios from "axios";
import { classnames } from "../utils/general";
import { languageOptions } from "../constants/languageOptions";

import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { defineTheme } from "../lib/defineTheme";
import useKeyPress from "../hooks/useKeyPress";
import Footer from "./Footer";
import OutputWindow from "./OutputWindow";
import CustomInput from "./CustomInput";
import OutputDetails from "./OutputDetails";
import ThemeDropdown from "./ThemeDropdown";
import LanguagesDropdown from "./LanguagesDropdown";
import CollaborationPanel from "./CollaborationPanel";
import { useCollaboration } from "../contexts/CollaborationContext";

const javascriptDefault = `/**
* Problem: Binary Search: Search a sorted array for a target value.
*/

// Time: O(log n)
const binarySearch = (arr, target) => {
 return binarySearchHelper(arr, target, 0, arr.length - 1);
};

const binarySearchHelper = (arr, target, start, end) => {
 if (start > end) {
   return false;
 }
 let mid = Math.floor((start + end) / 2);
 if (arr[mid] === target) {
   return mid;
 }
 if (arr[mid] < target) {
   return binarySearchHelper(arr, target, mid + 1, end);
 }
 if (arr[mid] > target) {
   return binarySearchHelper(arr, target, start, mid - 1);
 }
};

const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const target = 5;
console.log(binarySearch(arr, target));
`;

const Landing = () => {
  const [code, setCode] = useState(javascriptDefault);
  const [customInput, setCustomInput] = useState("");
  const [outputDetails, setOutputDetails] = useState(null);
  const [processing, setProcessing] = useState(null);
  const [theme, setTheme] = useState("cobalt");
  const [language, setLanguage] = useState(() => {
    // Find JavaScript in languageOptions (or use first option as fallback)
    const jsOption =
      languageOptions.find((opt) => opt.value === "javascript") ||
      languageOptions[0];
    return jsOption;
  });

  // Collaboration context
  const { updateLanguage, socket } = useCollaboration();

  const enterPress = useKeyPress("Enter");
  const ctrlPress = useKeyPress("Control");

  const onSelectChange = (sl) => {
    console.log("selected Option...", sl);
    // Make sure we're working with a valid selection
    if (sl && sl.value) {
      setLanguage(sl);
      // Reset code when language changes
      if (sl.value === "javascript") {
        setCode(javascriptDefault);
      } else {
        setCode("// Write your code here");
      }
      // Update language in collaboration session
      updateLanguage(sl);
      // Debug log
      console.log("Language state after change:", sl);
    }
  };

  const showSuccessToast = useCallback((msg) => {
    toast.success(msg || `Compiled Successfully!`, {
      position: "top-right",
      autoClose: 1000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
    });
  }, []);

  const showErrorToast = useCallback((msg, timer) => {
    toast.error(msg || `Something went wrong! Please try again.`, {
      position: "top-right",
      autoClose: timer ? timer : 1000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
    });
  }, []);

  const checkStatus = useCallback(
    async (token) => {
      console.log("Checking status for token:", token);
      const options = {
        method: "GET",
        url: process.env.REACT_APP_RAPID_API_URL + "/" + token,
        params: { base64_encoded: "true", fields: "*" },
        headers: {
          "X-RapidAPI-Host": process.env.REACT_APP_RAPID_API_HOST,
          "X-RapidAPI-Key": process.env.REACT_APP_RAPID_API_KEY,
        },
      };
      console.log("Status check URL:", options.url);
      try {
        console.log("Making status check request...");
        let response = await axios.request(options);
        console.log("Status check response:", response.data);
        let statusId = response.data.status?.id;
        console.log("Status ID:", statusId);

        // Processed - we have a result
        if (statusId === 1 || statusId === 2) {
          // still processing
          console.log(
            "Still processing (status ID 1 or 2), checking again in 2 seconds"
          );
          setTimeout(() => {
            checkStatus(token);
          }, 2000);
          return;
        } else {
          console.log("Processing complete, status ID:", statusId);
          setProcessing(false);
          setOutputDetails(response.data);
          showSuccessToast(`Compiled Successfully!`);
          console.log("Output details set:", response.data);
          return;
        }
      } catch (err) {
        console.log("Error checking status:", err);
        setProcessing(false);
        showErrorToast();
      }
    },
    [showSuccessToast, showErrorToast]
  );

  const handleCompile = useCallback(() => {
    console.log("=== COMPILE PROCESS STARTED ===");
    setProcessing(true);
    console.log("Compile button clicked");

    // Check if language is valid
    if (!language || !language.id) {
      console.log("Language validation failed:", language);
      showErrorToast("Please select a valid language");
      setProcessing(false);
      return;
    }
    console.log("Language validation passed:", language);

    // Log environment variables (without exposing API key completely)
    console.log("Environment variables check:");
    console.log("- API URL exists:", !!process.env.REACT_APP_RAPID_API_URL);
    console.log("- API HOST exists:", !!process.env.REACT_APP_RAPID_API_HOST);
    console.log("- API KEY exists:", !!process.env.REACT_APP_RAPID_API_KEY);
    console.log("- API URL value:", process.env.REACT_APP_RAPID_API_URL);
    console.log("- API HOST value:", process.env.REACT_APP_RAPID_API_HOST);
    console.log(
      "- API KEY prefix:",
      process.env.REACT_APP_RAPID_API_KEY
        ? process.env.REACT_APP_RAPID_API_KEY.substring(0, 4) + "..."
        : "missing"
    );

    // Check if the API keys are configured
    if (
      !process.env.REACT_APP_RAPID_API_URL ||
      !process.env.REACT_APP_RAPID_API_HOST ||
      !process.env.REACT_APP_RAPID_API_KEY
    ) {
      console.log("Using mock execution mode (no API keys)");

      // Mock execution for development purposes
      setTimeout(() => {
        console.log("Mock execution completed");
        setProcessing(false);

        // Create a mock response based on the language
        const mockOutput = btoa(
          "Output: Code executed successfully!\n" +
            (language.value === "javascript" ? "5" : "Hello, World!")
        );

        setOutputDetails({
          status: { id: 3, description: "Accepted" },
          stdout: mockOutput,
          stderr: btoa(""),
          compile_output: btoa(""),
          time: "0.001",
          memory: 0,
        });

        showSuccessToast("Mock execution completed");
      }, 1500);

      return;
    }

    console.log("Preparing API request with real credentials");

    try {
      const formData = {
        language_id: language.id,
        // encode source code in base64
        source_code: btoa(code),
        stdin: btoa(customInput),
      };

      console.log("Form data prepared:", {
        language_id: formData.language_id,
        source_code_length: formData.source_code
          ? formData.source_code.length
          : 0,
        stdin_length: formData.stdin ? formData.stdin.length : 0,
      });

      console.log("Sending request with language_id:", language.id);

      const options = {
        method: "POST",
        url: process.env.REACT_APP_RAPID_API_URL,
        params: { base64_encoded: "true", fields: "*" },
        headers: {
          "content-type": "application/json",
          "Content-Type": "application/json",
          "X-RapidAPI-Host": process.env.REACT_APP_RAPID_API_HOST,
          "X-RapidAPI-Key": process.env.REACT_APP_RAPID_API_KEY,
        },
        data: formData,
      };

      console.log("API request configuration:", {
        url: options.url,
        host: options.headers["X-RapidAPI-Host"],
        keyPrefix: options.headers["X-RapidAPI-Key"]
          ? options.headers["X-RapidAPI-Key"].substring(0, 4) + "..."
          : "missing",
      });

      console.log("About to make API request...");
      axios
        .request(options)
        .then(function (response) {
          console.log("API response received:", response.data);
          if (response.data && response.data.token) {
            const token = response.data.token;
            console.log("Token received:", token);
            checkStatus(token);
          } else {
            console.error(
              "Invalid response format - no token found:",
              response.data
            );
            throw new Error("Invalid response format");
          }
        })
        .catch((err) => {
          console.error("API request error:", err);
          console.error(
            "Full error object:",
            JSON.stringify(
              {
                message: err.message,
                hasResponse: !!err.response,
                responseStatus: err.response?.status,
                responseData: err.response?.data,
                hasRequest: !!err.request,
                config: err.config,
              },
              null,
              2
            )
          );

          let errorMessage = "Something went wrong! Please try again.";

          if (err.response) {
            // Server responded with error
            let status = err.response.status;
            console.log("Error status:", status);

            if (status === 429) {
              errorMessage =
                "Quota of 100 requests exceeded for the Day! Please read the blog on freeCodeCamp to learn how to setup your own RAPID API Judge0!";
            } else if (status === 401 || status === 403) {
              errorMessage =
                "API authentication failed. Please check your API key.";
            }
          } else if (err.request) {
            // Request made but no response
            errorMessage =
              "No response from the server. Please check your internet connection.";
          }

          showErrorToast(errorMessage, 5000);
          setProcessing(false);
        });
    } catch (error) {
      console.error("Error before API request:", error);
      showErrorToast("Error preparing API request: " + error.message);
      setProcessing(false);
    }
  }, [
    code,
    customInput,
    language,
    checkStatus,
    showErrorToast,
    showSuccessToast,
  ]);

  useEffect(() => {
    if (enterPress && ctrlPress) {
      console.log("enterPress", enterPress);
      console.log("ctrlPress", ctrlPress);
      handleCompile();
    }
  }, [ctrlPress, enterPress, handleCompile]);

  const onChange = (action, data) => {
    switch (action) {
      case "code": {
        setCode(data);
        break;
      }
      default: {
        console.warn("case not handled!", action, data);
      }
    }
  };

  function handleThemeChange(th) {
    const theme = th;
    console.log("theme...", theme);

    if (["light", "vs-dark"].includes(theme.value)) {
      setTheme(theme);
    } else {
      defineTheme(theme.value).then((_) => setTheme(theme));
    }
  }

  useEffect(() => {
    defineTheme("oceanic-next").then((_) =>
      setTheme({ value: "oceanic-next", label: "Oceanic Next" })
    );
  }, []);

  // Listen for code updates from other users in collaboration session
  useEffect(() => {
    if (socket) {
      socket.on(
        "session-data",
        ({ code: sessionCode, language: sessionLanguage }) => {
          if (sessionCode) {
            setCode(sessionCode);
          }
          if (sessionLanguage) {
            setLanguage(sessionLanguage);
          }
        }
      );

      socket.on("language-changed", ({ language: newLanguage }) => {
        if (newLanguage) {
          setLanguage(newLanguage);
        }
      });
    }

    return () => {
      if (socket) {
        socket.off("session-data");
        socket.off("language-changed");
      }
    };
  }, [socket]);

  return (
    <>
      <ToastContainer
        position="top-right"
        autoClose={2000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />

      <a
        href="link will be added soon"
        title="Fork me on GitHub"
        class="github-corner"
        target="_blank"
        rel="noreferrer"
      >
        <svg
          width="50"
          height="50"
          viewBox="0 0 250 250"
          className="relative z-20 h-20 w-20"
        >
          <title>Fork me on GitHub</title>
          <path d="M0 0h250v250"></path>
          <path
            d="M127.4 110c-14.6-9.2-9.4-19.5-9.4-19.5 3-7 1.5-11 1.5-11-1-6.2 3-2 3-2 4 4.7 2 11 2 11-2.2 10.4 5 14.8 9 16.2"
            fill="currentColor"
            style={{ transformOrigin: "130px 110px" }}
            class="octo-arm"
          ></path>
          <path
            d="M113.2 114.3s3.6 1.6 4.7.6l15-13.7c3-2.4 6-3 8.2-2.7-8-11.2-14-25 3-41 4.7-4.4 10.6-6.4 16.2-6.4.6-1.6 3.6-7.3 11.8-10.7 0 0 4.5 2.7 6.8 16.5 4.3 2.7 8.3 6 12 9.8 3.3 3.5 6.7 8 8.6 12.3 14 3 16.8 8 16.8 8-3.4 8-9.4 11-11.4 11 0 5.8-2.3 11-7.5 15.5-16.4 16-30 9-40 .2 0 3-1 7-5.2 11l-13.3 11c-1 1 .5 5.3.8 5z"
            fill="currentColor"
            class="octo-body"
          ></path>
        </svg>
      </a>

      <div className="h-4 w-full bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500"></div>
      <div className="flex flex-row">
        <div className="px-4 py-2">
          <LanguagesDropdown
            onSelectChange={onSelectChange}
            language={language}
          />
        </div>
        <div className="px-4 py-2">
          <ThemeDropdown handleThemeChange={handleThemeChange} theme={theme} />
        </div>
      </div>
      <div className="flex flex-row space-x-4 items-start px-4 py-4">
        <div className="flex flex-col w-full h-full justify-start items-end">
          {console.log(
            "Rendering CodeEditorWindow with language:",
            language?.value
          )}
          <CodeEditorWindow
            code={code}
            onChange={onChange}
            language={language?.value}
            theme={theme.value}
          />
        </div>

        <div className="right-container flex flex-shrink-0 w-[30%] flex-col">
          <CollaborationPanel />

          <OutputWindow outputDetails={outputDetails} />
          <div className="flex flex-col items-end">
            <CustomInput
              customInput={customInput}
              setCustomInput={setCustomInput}
            />
            <button
              onClick={handleCompile}
              disabled={!code}
              className={classnames(
                "mt-4 border-2 border-black z-10 rounded-md shadow-[5px_5px_0px_0px_rgba(0,0,0)] px-4 py-2 hover:shadow transition duration-200 bg-white flex-shrink-0",
                !code ? "opacity-50" : ""
              )}
            >
              {processing ? "Processing..." : "Compile and Execute"}
            </button>
          </div>
          {outputDetails && <OutputDetails outputDetails={outputDetails} />}
        </div>
      </div>
      <Footer />
    </>
  );
};
export default Landing;
