import { Component } from '@angular/core';
import { OverlapNewService } from './modifiedOverlap.service';
import { OverlapService } from './overlap.service';
// import { OverlapServiceV2 } from './overlapV2.service';

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
 
  status:any='';
  constructor(public svc: OverlapService, public newser:OverlapNewService) {
    // subscribe to incoming parsed features
    // svc.feature$.subscribe(f => {
    //   this.files.push({ id: f.id, name: f.name });
    //   // auto-select first file once parsing starts
    //   if (!this.targetId) {
    //     this.targetId = f.id;
    //   }
      
    // });




    this.newser.feature$.subscribe(f =>{
      //  console.log('parsed', f)
       this.status = f.name;
      });

    this.newser.done$.subscribe(() => {
      console.log('DONE--');
      let t1 = performance.now();
                                    
      // without R-tree:
      // const mat1 = this.newser.computeMatrixFromParsed(false);
      // with R-tree:
      
      // this.newser.checkOverlap().then(result=>{
      //   let t2 = performance.now();
      //    console.log('time taken to complete overlap', (t2 - t1) / 1000 + 's');
      //    console.log('from worker promise method',result);

      // });


      const mat1 = this.newser.computeJSONFromParsed(false);
      
      console.log('without worker',mat1);
      let t2 = performance.now();
      console.log('time taken to complete overlap', (t2 - t1) / 1000 + 's');



      // this.serviceTYpe2.runOverlap().then(d=>{
      //   console.log(d);
      // });
      
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
      file.arrayBuffer().then(buf => this.newser.loadZip(buf));
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
    // this.detectingAll = true;
    // this.allPairs = [];
    // this.svc.detectAllOverlaps().subscribe(pairs => {
    //   this.allPairs = pairs;
    //   this.detectingAll = false;
    // });
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



  fileChangeEvent(file:any){
    if (file.target.files) {
      file.arrayBuffer().then((buf:any) => this.newser.loadZip(buf));
    }
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




      // const all = Array.from(this.feats.values());

// 1) naive JSON
// const json1 = this.overlapService.computeOverlapJson(all);
// 2) R-tree optimized JSON
// const json2 = this.overlapService.computeOverlapJsonTree(all);

// console.log(JSON.stringify(json2, null, 2));
  }
}
