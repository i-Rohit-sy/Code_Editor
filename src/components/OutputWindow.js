import React, { useEffect } from "react";

const OutputWindow = ({ outputDetails }) => {
  useEffect(() => {
    if (outputDetails) {
      console.log("OutputWindow received details:", {
        hasStatus: !!outputDetails.status,
        statusId: outputDetails.status?.id,
        hasStdout: !!outputDetails.stdout,
        hasStderr: !!outputDetails.stderr,
        hasCompileOutput: !!outputDetails.compile_output,
      });
    }
  }, [outputDetails]);

  const getOutput = () => {
    let statusId = outputDetails?.status?.id;
    console.log("Rendering output for status ID:", statusId);

    if (statusId === 6) {
      // compilation error
      console.log("Compilation error detected, rendering compile_output");
      try {
        const decodedOutput = atob(outputDetails?.compile_output || "");
        console.log("Decoded compilation error:", decodedOutput);
        return (
          <pre className="px-2 py-1 font-normal text-xs text-red-500">
            {decodedOutput}
          </pre>
        );
      } catch (e) {
        console.error("Error decoding compile_output:", e);
        return (
          <pre className="px-2 py-1 font-normal text-xs text-red-500">
            Error decoding output
          </pre>
        );
      }
    } else if (statusId === 3) {
      console.log("Success status detected, rendering stdout");
      try {
        const decodedOutput = atob(outputDetails.stdout || "");
        console.log("Decoded stdout:", decodedOutput);
        return (
          <pre className="px-2 py-1 font-normal text-xs text-green-500">
            {decodedOutput !== null ? decodedOutput : null}
          </pre>
        );
      } catch (e) {
        console.error("Error decoding stdout:", e);
        return (
          <pre className="px-2 py-1 font-normal text-xs text-green-500">
            Error decoding output
          </pre>
        );
      }
    } else if (statusId === 5) {
      console.log("Time limit exceeded status detected");
      return (
        <pre className="px-2 py-1 font-normal text-xs text-red-500">
          {`Time Limit Exceeded`}
        </pre>
      );
    } else {
      console.log("Other status detected, rendering stderr");
      try {
        const decodedError = atob(outputDetails?.stderr || "");
        console.log("Decoded stderr:", decodedError);
        return (
          <pre className="px-2 py-1 font-normal text-xs text-red-500">
            {decodedError}
          </pre>
        );
      } catch (e) {
        console.error("Error decoding stderr:", e);
        return (
          <pre className="px-2 py-1 font-normal text-xs text-red-500">
            Error decoding error output
          </pre>
        );
      }
    }
  };
  return (
    <>
      <h1 className="font-bold text-xl bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 mb-2">
        Output
      </h1>
      <div className="w-full h-56 bg-[#1e293b] rounded-md text-white font-normal text-sm overflow-y-auto">
        {outputDetails ? (
          <>
            {console.log("Rendering output component")}
            {getOutput()}
          </>
        ) : (
          <div className="px-2 py-1 text-xs">
            {console.log("No output details to display")}
            No output to display yet. Click "Compile and Execute" to run your
            code.
          </div>
        )}
      </div>
    </>
  );
};

export default OutputWindow;
