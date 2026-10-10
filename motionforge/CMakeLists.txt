cmake_minimum_required(VERSION 3.21)
project(MotionForge VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(Qt6 6.4 REQUIRED COMPONENTS Core Gui Widgets Qml Test)
find_package(PkgConfig REQUIRED)
pkg_check_modules(FFMPEG REQUIRED IMPORTED_TARGET
  libavformat libavcodec libavutil libswscale)

# Core library: everything except the window, so tests can link it headless.
add_library(mfcore STATIC
  src/core/Property.cpp
  src/core/Effect.cpp
  src/core/Layer.cpp
  src/core/Project.cpp
  src/expr/ExpressionEngine.cpp
  src/render/Effects.cpp
  src/render/Renderer.cpp
  src/render/FrameCache.cpp
  src/media/VideoDecoder.cpp
  src/media/MediaCache.cpp
  src/media/Exporter.cpp
)
target_include_directories(mfcore PUBLIC src)
target_link_libraries(mfcore PUBLIC Qt6::Core Qt6::Gui Qt6::Qml PkgConfig::FFMPEG)
target_compile_options(mfcore PRIVATE -Wall -Wextra -Wno-unused-parameter)

add_library(mfui STATIC
  src/ui/Editor.cpp
  src/ui/Theme.cpp
  src/ui/Icons.cpp
  src/ui/ScrubField.cpp
  src/ui/MainWindow.cpp
  src/ui/ProjectPanel.cpp
  src/ui/CompViewer.cpp
  src/ui/TimelinePanel.cpp
  src/ui/EffectControlsPanel.cpp
  src/ui/EffectsPresetsPanel.cpp
  src/ui/CharacterPanel.cpp
  src/ui/InfoPreviewPanel.cpp
  src/ui/RenderQueuePanel.cpp
  src/ui/Dialogs.cpp
  src/ui/PlaybackController.cpp
)
target_link_libraries(mfui PUBLIC mfcore Qt6::Widgets)
target_compile_options(mfui PRIVATE -Wall -Wextra -Wno-unused-parameter)

add_executable(motionforge src/main.cpp)
target_link_libraries(motionforge PRIVATE mfui)

enable_testing()
add_executable(mftests tests/test_main.cpp)
target_link_libraries(mftests PRIVATE mfcore Qt6::Test)
add_test(NAME mftests COMMAND mftests)
add_executable(mfguitests tests/test_gui.cpp)
target_link_libraries(mfguitests PRIVATE mfui Qt6::Test)
add_test(NAME mfguitests COMMAND mfguitests)
set_tests_properties(mftests mfguitests PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")

install(TARGETS motionforge RUNTIME DESTINATION bin)
install(FILES packaging/motionforge.desktop DESTINATION share/applications)
install(FILES packaging/motionforge.svg DESTINATION share/icons/hicolor/scalable/apps)

set(CPACK_GENERATOR DEB)
set(CPACK_PACKAGE_NAME motionforge)
set(CPACK_PACKAGE_CONTACT "kalidatuna")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Motion graphics and compositing with an After Effects-style workflow")
set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS ON)
set(CPACK_DEBIAN_PACKAGE_SECTION graphics)
include(CPack)
