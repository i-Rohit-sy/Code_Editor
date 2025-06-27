import React, { useEffect } from "react";
import Select from "react-select";
import { customStyles } from "../constants/customStyles";
import { languageOptions } from "../constants/languageOptions";

const LanguagesDropdown = ({ onSelectChange, language }) => {
  // Add debugging to track props changes
  useEffect(() => {
    console.log("LanguagesDropdown received language:", language);
  }, [language]);

  // Ensure dropdown has valid options and handlers
  const handleChange = (selectedOption) => {
    console.log("LanguagesDropdown selected:", selectedOption);
    onSelectChange(selectedOption);
  };

  return (
    <Select
      placeholder={`Select Language`}
      options={languageOptions}
      styles={customStyles}
      value={language}
      onChange={handleChange}
      isSearchable={true}
      className="language-dropdown"
      classNamePrefix="language-select"
      menuPortalTarget={document.body}
      menuPosition={"fixed"}
      // Force menu to open above to avoid potential overlay issues
      menuPlacement="auto"
    />
  );
};

export default LanguagesDropdown;
