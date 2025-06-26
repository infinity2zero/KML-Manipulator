// src/app/models/menu-item.ts
export interface MenuItem {
  label:    string;
  icon?:    string;          // optional CSS class or SVG
  link?:    string;          // routerLink or href
  children?: MenuItem[];     // nested sub-menus
}
