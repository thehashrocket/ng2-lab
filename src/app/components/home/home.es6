import { ComponentAnnotation as Component, ViewAnnotation as View } from 'angular2/angular2';

@Component({
	selector: 'home'
})

@View({
	templateUrl: 'app/components/home/home.html',
	directives: []
})

export class Home {
	constructor() {}
}