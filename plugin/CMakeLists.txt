# Meat Thumb — Audio Unit (and a standalone app) built with JUCE.
#
#   ./build.sh            # build
#   ./build.sh install    # build, install to ~/Library/Audio/Plug-Ins/Components, run auval
#
# JUCE: pass -DJUCE_DIR=/path/to/JUCE, or it's fetched (8.0.9) at configure time.
cmake_minimum_required(VERSION 3.22)
project(MeatThumb VERSION 0.3.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(JUCE_DIR)
  add_subdirectory("${JUCE_DIR}" juce)
else()
  include(FetchContent)
  FetchContent_Declare(juce GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.9 GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(juce)
endif()

juce_add_plugin(MeatThumb
  PRODUCT_NAME "Meat Thumb"
  COMPANY_NAME "Meat Thumb"
  BUNDLE_ID com.meatthumb.synth
  DESCRIPTION "A fat, weird, quantum-flavoured synth"
  PLUGIN_MANUFACTURER_CODE MtTb
  PLUGIN_CODE MtT1
  FORMATS AU Standalone
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS TRUE
  AU_MAIN_TYPE kAudioUnitType_MusicDevice
  COPY_PLUGIN_AFTER_BUILD FALSE)

# ---- The web UI, zipped into the binary ------------------------------------------
set(UI_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/..")
file(GLOB_RECURSE UI_FILES CONFIGURE_DEPENDS
  "${UI_ROOT}/src/*.js" "${UI_ROOT}/src/*.css" "${UI_ROOT}/assets/*.webp" "${UI_ROOT}/assets/*.png")
set(UI_REL index.html)
foreach(f IN LISTS UI_FILES)
  file(RELATIVE_PATH r "${UI_ROOT}" "${f}")
  list(APPEND UI_REL "${r}")
endforeach()
set(UI_ZIP "${CMAKE_CURRENT_BINARY_DIR}/ui.zip")
add_custom_command(
  OUTPUT "${UI_ZIP}"
  COMMAND "${CMAKE_COMMAND}" -E rm -f "${UI_ZIP}"
  COMMAND "${CMAKE_COMMAND}" -E tar cf "${UI_ZIP}" --format=zip -- ${UI_REL}
  WORKING_DIRECTORY "${UI_ROOT}"
  DEPENDS "${UI_ROOT}/index.html" ${UI_FILES}
  COMMENT "Zipping the web UI"
  VERBATIM)
juce_add_binary_data(MeatThumbUI SOURCES "${UI_ZIP}")

# ---- Sources -----------------------------------------------------------------------
file(GLOB DSP_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/Source/dsp/*.cpp")
target_sources(MeatThumb PRIVATE
  Source/PluginProcessor.cpp
  Source/PluginEditor.cpp
  ${DSP_SOURCES})
target_include_directories(MeatThumb PRIVATE Source)

target_compile_definitions(MeatThumb PUBLIC
  JUCE_WEB_BROWSER=1
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0
  JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(MeatThumb
  PRIVATE
    MeatThumbUI
    juce::juce_audio_utils
    juce::juce_gui_extra
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags)
