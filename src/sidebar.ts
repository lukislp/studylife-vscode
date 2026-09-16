// The Activity Bar view. A TreeDataProvider rather than a webview on purpose: it inherits the
// editor's theme and font for free and costs no separate renderer process. Everything decided
// here is rendering; what to show lives in sidebarModel.ts.
import * as vscode from "vscode";
import { type Row, type Snapshot, buildTree } from "./sidebarModel.js";

class Node extends vscode.TreeItem {
  constructor(
    readonly row: Row,
    collapsible: vscode.TreeItemCollapsibleState,
  ) {
    super(row.label, collapsible);
    if (row.detail !== undefined) this.description = row.detail;
    if (row.icon !== undefined) this.iconPath = new vscode.ThemeIcon(row.icon);
    if (row.command !== undefined) {
      this.command = { command: row.command, title: row.label };
      // The tooltip is the only place a narrow panel can explain what clicking does.
      this.tooltip = row.detail ?? row.label;
    }
  }
}

export class StudyLifeTreeProvider implements vscode.TreeDataProvider<Row> {
  private readonly changed = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private snapshot: Snapshot = { connected: false, now: Date.now() };

  update(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.changed.fire(undefined);
  }

  getTreeItem(row: Row): vscode.TreeItem {
    const state = row.children?.length
      ? row.expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    return new Node(row, state);
  }

  getChildren(row?: Row): Row[] {
    return row ? (row.children ?? []) : buildTree(this.snapshot);
  }
}
