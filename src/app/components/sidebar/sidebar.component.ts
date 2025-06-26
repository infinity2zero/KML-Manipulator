import { Component } from '@angular/core';
import { MenuItem } from '../../model/menu-item';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent {
  public collapsed = false;

  toggleSidebar() {
    this.collapsed = !this.collapsed;
  }

  menuItems: MenuItem[] = [
    { label: 'Dashboard', icon:'fa fa-home', link:'/home' },
    {
      label: 'Projects',
      icon: 'fa fa-folder',
      children: [
        { label: 'Alpha', link: '/projects/a' },
        { label: 'Beta',  link: '/projects/b' }
      ]
    },
    {
      label: 'Settings',
      icon:'fa fa-cog',
      children: [
        { label: 'Profile', link:'/settings/profile' },
        { label: 'Security', link:'/settings/security' }
      ]
    }
  ];
}
