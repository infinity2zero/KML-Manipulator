import { Component } from '@angular/core';
import { OverlapService } from './overlap.service';
import { OverlapNewService } from './worker/overlapnew.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  // list of parsed KML files
  files: { id: string; name: string }[] = [];
  // single‐target selection
  targetId: string | null = null;
  // result strings for single‐target check
  singleResult: string | null = null;
  // control flags
  checkingOne = false;
  detectingAll = false;
  // full list of overlapping pairs
  allPairs: [string, string][] = [];

  constructor(public svc: OverlapService, public newser:OverlapNewService) {
    // subscribe to incoming parsed features
    svc.feature$.subscribe(f => {
      this.files.push({ id: f.id, name: f.name });
      // auto-select first file once parsing starts
      if (!this.targetId) {
        this.targetId = f.id;
      }
    });
  }

  // handle drag & drop
  onDragOver(evt: DragEvent) {
    evt.preventDefault();
  }

  onDrop(evt: DragEvent) {
    evt.preventDefault();
    this.reset();
    const file = evt.dataTransfer?.files[0];
    if (file) {
      file.arrayBuffer().then(buf => this.svc.loadZip(buf));
    }
  }

  // single‐target overlap check
  // checkOne() {
  //   if (!this.targetId) return;
  //   this.checkingOne = true;
  //   this.singleResult = 'Working…';
  //   this.svc.checkOverlap(this.targetId).subscribe(res => {
  //     this.singleResult = res.misses.length
  //       ? `❌ Missed: ${res.misses.join(', ')}`
  //       : '✅ All overlap';
  //     this.checkingOne = false;
  //   });
  // }

  // full all-pairs overlap detection
  detectAll() {
    this.detectingAll = true;
    this.allPairs = [];
    this.svc.detectAllOverlaps().subscribe(pairs => {
      this.allPairs = pairs;
      this.detectingAll = false;
    });
  }

  // reset UI state when loading a new ZIP
  private reset() {
    this.files = [];
    this.targetId = null;
    this.singleResult = null;
    this.allPairs = [];
    this.checkingOne = false;
    this.detectingAll = false;
  }


  customMethod(){
    // 1) start parsing
      // this.newser.loadZip(zipArrayBuffer);

      // 2) subscribe to features for UI feedback
       this.newser.feature$.subscribe(f => console.log('parsed', f));

      // 3) when parsing completes, build the matrix
      this.newser.done$.subscribe(() => {
        // without R-tree:
        const mat1 = this.newser.computeMatrixFromParsed(false);
        // with R-tree:
        const mat2 = this.newser.computeMatrixFromParsed(true);
        console.table(mat2);
      });
  }

  // 1) start parsing

}
