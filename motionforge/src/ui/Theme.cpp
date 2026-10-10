#include "Theme.h"

#include <QApplication>
#include <QFont>
#include <QPalette>
#include <QStyleFactory>

namespace mf::theme {

void apply(QApplication &app)
{
    app.setStyle(QStyleFactory::create("Fusion"));
    QPalette p;
    p.setColor(QPalette::Window, panel);
    p.setColor(QPalette::WindowText, text);
    p.setColor(QPalette::Base, QColor(0x1a, 0x1a, 0x1a));
    p.setColor(QPalette::AlternateBase, panelAlt);
    p.setColor(QPalette::ToolTipBase, QColor(0x30, 0x30, 0x30));
    p.setColor(QPalette::ToolTipText, text);
    p.setColor(QPalette::Text, text);
    p.setColor(QPalette::Button, QColor(0x33, 0x33, 0x33));
    p.setColor(QPalette::ButtonText, text);
    p.setColor(QPalette::BrightText, Qt::white);
    p.setColor(QPalette::Highlight, accent);
    p.setColor(QPalette::HighlightedText, Qt::white);
    p.setColor(QPalette::Link, value);
    p.setColor(QPalette::PlaceholderText, textDim);
    p.setColor(QPalette::Disabled, QPalette::Text, QColor(0x60, 0x60, 0x60));
    p.setColor(QPalette::Disabled, QPalette::ButtonText, QColor(0x60, 0x60, 0x60));
    p.setColor(QPalette::Disabled, QPalette::WindowText, QColor(0x60, 0x60, 0x60));
    app.setPalette(p);

    QFont f = app.font();
    f.setPointSizeF(9.0);
    app.setFont(f);

    app.setStyleSheet(R"(
QMainWindow { background: #141414; }
QMainWindow::separator { background: #141414; width: 4px; height: 4px; }
QMainWindow::separator:hover { background: #2d8ceb; }
QDockWidget { color: #c6c6c6; titlebar-close-icon: none; }
QDockWidget::title { background: #232323; padding: 4px 8px; border-bottom: 1px solid #141414; }
QTabBar::tab { background: #1d1d1d; color: #8a8a8a; padding: 4px 12px; border: none; border-right: 1px solid #141414; }
QTabBar::tab:selected { background: #232323; color: #e6e6e6; border-bottom: 2px solid #2d8ceb; }
QTabBar::tab:hover { color: #e6e6e6; }
QMenuBar { background: #1d1d1d; color: #c6c6c6; }
QMenuBar::item:selected { background: #333; }
QMenu { background: #262626; color: #d0d0d0; border: 1px solid #111; }
QMenu::item { padding: 4px 28px 4px 22px; }
QMenu::item:selected { background: #2d8ceb; color: white; }
QMenu::item:disabled { color: #5a5a5a; }
QMenu::separator { height: 1px; background: #3a3a3a; margin: 3px 6px; }
QToolBar { background: #1d1d1d; border: none; border-bottom: 1px solid #141414; spacing: 2px; padding: 2px; }
QToolButton { background: transparent; border: 1px solid transparent; border-radius: 3px; padding: 2px; color: #c6c6c6; }
QToolButton:hover { background: #333; }
QToolButton:checked { background: #1f4f80; border-color: #2d8ceb; }
QPushButton { background: #333; border: 1px solid #444; border-radius: 3px; padding: 4px 12px; color: #d6d6d6; }
QPushButton:hover { background: #3c3c3c; }
QPushButton:pressed { background: #2d8ceb; }
QPushButton:default { border-color: #2d8ceb; }
QLineEdit, QPlainTextEdit, QTextEdit, QSpinBox, QDoubleSpinBox, QComboBox {
  background: #161616; border: 1px solid #3a3a3a; border-radius: 2px; padding: 2px 4px; color: #d6d6d6;
  selection-background-color: #2d8ceb; }
QLineEdit:focus, QPlainTextEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus { border-color: #2d8ceb; }
QComboBox::drop-down { border: none; width: 16px; }
QComboBox QAbstractItemView { background: #262626; selection-background-color: #2d8ceb; }
QTreeView, QListView, QTableView { background: #1f1f1f; alternate-background-color: #232323; border: none;
  selection-background-color: #3a3a3a; selection-color: #ffffff; }
QTreeView::item:selected, QTableView::item:selected { background: #3a3a3a; }
QHeaderView::section { background: #262626; color: #9a9a9a; border: none; border-right: 1px solid #1a1a1a;
  border-bottom: 1px solid #1a1a1a; padding: 3px 6px; }
QScrollBar:vertical { background: #1d1d1d; width: 12px; margin: 0; }
QScrollBar:horizontal { background: #1d1d1d; height: 12px; margin: 0; }
QScrollBar::handle { background: #444; border-radius: 4px; min-height: 24px; min-width: 24px; margin: 2px; }
QScrollBar::handle:hover { background: #555; }
QScrollBar::add-line, QScrollBar::sub-line { width: 0; height: 0; }
QScrollBar::add-page, QScrollBar::sub-page { background: none; }
QCheckBox { color: #c6c6c6; }
QCheckBox::indicator { width: 13px; height: 13px; border: 1px solid #555; background: #161616; border-radius: 2px; }
QCheckBox::indicator:checked { background: #2d8ceb; border-color: #2d8ceb; }
QGroupBox { border: 1px solid #333; border-radius: 3px; margin-top: 12px; padding-top: 6px; }
QGroupBox::title { subcontrol-origin: margin; left: 8px; color: #9a9a9a; }
QSlider::groove:horizontal { height: 3px; background: #444; }
QSlider::handle:horizontal { width: 10px; margin: -5px 0; background: #bbb; border-radius: 5px; }
QSlider::sub-page:horizontal { background: #2d8ceb; }
QProgressBar { border: 1px solid #333; background: #161616; text-align: center; color: #ddd; height: 14px; }
QProgressBar::chunk { background: #2d8ceb; }
QStatusBar { background: #1d1d1d; color: #8a8a8a; }
QToolTip { background: #303030; color: #e0e0e0; border: 1px solid #111; }
QSplitter::handle { background: #141414; }
)");
}

} // namespace mf::theme
