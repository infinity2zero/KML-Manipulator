// src/app/components/sidebar-tree/sidebar-tree.component.ts
import { Component, Input } from '@angular/core';
import { MenuItem }          from '../../model/menu-item';

@Component({
  selector: 'app-sidebar-tree',
  templateUrl: './sidebar-tree.component.html',
  styleUrls: ['./sidebar-tree.component.scss']
})
export class SidebarTreeComponent {
  @Input() items: MenuItem[] = [];
  @Input() collapsed = false;
  expanded = new Set<MenuItem>();
//   menuItems: MenuItem[] = [];
  // track expanded state by index (or generate IDs)

  toggle(item: MenuItem) {
    this.expanded.has(item)
      ? this.expanded.delete(item)
      : this.expanded.add(item);
  }

  isOpen(item: MenuItem) {
    return this.expanded.has(item);
  }
  
}
