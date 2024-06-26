'use strict';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers'
import fs from "fs/promises";
import path from "path";
import { schema, trace_validator, typecast, SCHEMA_VALIDATOR_RAW_SOURCE, SCHEMA_VALIDATOR_SOURCE, SCHEMA_VALIDATOR_SOURCE_FOR_DOC, SCHEMA_VALIDATOR_NAME, SCHEMA_VALIDATOR_COMMENT, SCHEMA_VALIDATOR_COMMENT_SOURCE} from 'vanilla-schema-validator';
import { rip_comments, rip_directives } from  'comment-ripper' ;
import child_process from 'node:child_process';

function inspect(s) {
  return JSON.stringify( s, (k,v)=>typeof v === 'function' ? v.toString() : v, 2 );
}






const DEBUG = false;
const VANILLA_SCHEMA_VALIDATOR_MODULES           = Symbol.for( 'vanilla-schema-validator.modules' );
const VANILLA_SCHEMA_VALIDATOR_DIRECTIVE_0 = [ 'VANILLA_SCHEMA_VALIDATOR', 'ENABLE', 'TRANSPILE' ];
const VANILLA_SCHEMA_VALIDATOR_DIRECTIVE_1 = [ 'VANILLA_SCHEMA_VALIDATOR', 'ENABLE', 'DOCUMENTATION' ];

const compare_arrays = (a1, a2) =>
  a1.length == a2.length &&
  a1.every( (element, index) => element === a2[index] );



async function* getFiles( dir ) {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  for ( const dirent of dirents ) {
    const filename = path.join( dir, dirent.name );
    if ( dirent.isDirectory() ) {
      yield* getFiles( filename );
    } else {
      yield filename;
    }
  }
}


async function proc_build(nargs) {
  if ( DEBUG ) {
    console.log(nargs);
  }
  const {
    inputDir,
    outputDir,
    extensions,
    fn_module_to_string,
    fn_check_directive,
    fn_output_filename,
  }= nargs;

  const async_results = [];
  const request_paths = [];

  console.log( 'building ... ', inputDir );
  for await ( const rel_path of getFiles( inputDir ) ) {
    if ( extensions.some( e=>rel_path.endsWith( e ) ) ) {
      console.log( 'examiniing:', rel_path );
      const f = (await fs.readFile( rel_path )).toString();
      const r = rip_directives( rip_comments( f ) ).map( s=>s.split( /\s+/ ).map(e=>e.trim() ) );

      // HERE
      if ( r.some( directive_arr=>fn_check_directive( directive_arr ) ) ) {
        const abs_path = path.resolve( process.cwd(), rel_path );
        console.log( 'importing ', abs_path );
        request_paths.push( abs_path );
        async_results.push( import( abs_path  ) );
      } else {
        // console.log( rel_path, 'ignored2', r );
      }
    } else {
      // console.log( rel_path, 'ignored' );
    }
  };

  await Promise.all( async_results );

  const modules = schema[VANILLA_SCHEMA_VALIDATOR_MODULES];


  if ( DEBUG ) {
    console.error( 'modules', modules );
    console.error( 'all', modules
      .map(e=>e.filename) );
    console.error( 'filtered', modules
      .filter(e=>request_paths.some( ee=>ee===e.filename ))
      .map(e=>e.filename)
    );
    console.error( 'request_paths',
      request_paths );
  }

  const compiled_modules = modules
    .filter( module=>request_paths.some( ee=>ee===module.filename ))
    .map(module=>({
      ...module,
      output_filename : path.join( outputDir, path.relative( inputDir, fn_output_filename(module) ) ),
      output_string   : fn_module_to_string( module ), // module.transpile() // HERE
    }));

  if ( DEBUG ) {
    console.error( 'compiled', compiled_modules   );
  }

  for ( const module of compiled_modules ) {
    const output_file = module.output_filename;
    const output_string = module.output_string;
    fs.mkdir( path.dirname( output_file ), {recursive:true} );
    fs.writeFile( output_file, output_string );
    console.log( 'writing to', output_file );
  }
}


function module_to_source( module ) {
  let s='';
  function output( l ) {
    s = s+l;
  }

  output( 'import { schema } from "vanilla-schema-validator";\n' );
  if ( module.header ) {
    output( module.header );
  }
  output( '\n' );
  output( 'schema.define\`\n' );
  output(
    module.validator_list.map(
      (e,i)=>{
        switch ( e.type ) {
          case 'validator_factory' :
            // console.error( e.value[SCHEMA_VALIDATOR_SOURCE] );
            return (
              (`${e?.value?.[SCHEMA_VALIDATOR_SOURCE]}` ).split('\n').map(
                e=>{
                  return e.replaceAll( /(\s*,\s*)+/gm, ',' )
                }
              ).join('\n')
            );
            break;
          case 'description':
            // do nothing
            break;
          default:
            throw new Error( `unknown type ${e.type}` );
            break;
        }
      }
    ).filter(e=>e!==null&&e!==undefined).map(e=>{
      return e.replace( /\s*,\s*$/, '\n' );
    })
  );
  output( '`' );

  if ( module.footer ) {
    output( module.footer );
  }

  return s;
}

const noescape_markdown = (s)=>{
  s = s.replace( /_/gm, '\\_' );
  return s;
}
const escape_markdown = (s)=>{
  s = s.replace( /_/gm, '\\_' );
  return s;
}


function module_to_html( module ) {
  let s='';
  function output( l ) {
    s = s+l;
  }

  output(`
  <html>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>

    <!-- and it's easy to individually load additional languages -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/go.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/showdown/2.1.0/showdown.min.js" integrity="sha512-LhccdVNGe2QMEfI3x4DVV3ckMRe36TfydKss6mJpdHjNFiV07dFpS2xzeZedptKZrwxfICJpez09iNioiSZ3hA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script>hljs.highlightAll();</script>
    <script>
      addEventListener("load", (event) => {
        const divs = Array.from( document.getElementsByClassName('vsv-descriptions'))
        divs.forEach( e=>{
          const converter = new showdown.Converter();
          const md   = e.innerHTML
          const html = converter.makeHtml(md);
          e.innerHTML = html;
        });
      });
    </script>
    <body>
  `);

  output( '\n' );
  output(
    module.validator_list.map( (e,i)=>{
      switch ( e.type ) {
        case 'validator_factory' :
          return (
            `<h3>${e?.value?.name??''}</h3>\n`+
            `<div class='vsv-descriptions'>${escape_markdown( e?.value?.[SCHEMA_VALIDATOR_COMMENT]??'')}</div>\n`+
            `<pre><code class="language-javascript">${e?.value?.[SCHEMA_VALIDATOR_SOURCE_FOR_DOC]??''}</code></pre>\n`+
            `\n`
          );
          break;
        case 'description':
          return (
            `<div class='vsv-descriptions'>${escape_markdown( e?.value?.template_output ?? '' )}</div>\n`+
            `\n`
          );
          break;
        default:
          throw new Error( `unknown type ${e.type}` );
          break;
      }
    }).map(e=>e.replace(/(\s*,\s*)+$/,'')).join('\n')
  );

  output(`
    </body>
  </html>
  `);

  return s;
}




function module_to_markdown( module ) {
  let s='';
  function output( l ) {
    s = s + (l ?? "").replace(/^    |^  /gm, '' ).replace(/^\s*$/gm,'');
  }

  output(`
      Documentation
    =====================
  `);

  output( '\n' );
  output(
    module.validator_list
    .map(
      (e,i)=>{
        switch ( e.type ) {
          case 'validator_factory':
            return (
              `### ${escape_markdown(e?.value?.name ?? (()=>{throw new Error( "internal error" )})() )} ###\n` +
              `${escape_markdown( e?.value?.[SCHEMA_VALIDATOR_COMMENT]??'')}\n` +
              `\n`+
              `\`\`\`javascript\n` +
              `${e?.value?.[SCHEMA_VALIDATOR_SOURCE_FOR_DOC]??''}\n` +
              `\`\`\`\n`+
              ``
            )
            break;
          case 'description':
            return (
              `\n` +
              `${escape_markdown( e?.value?.template_output ?? '' )}\n` +
              `\n`
            );
          break;
          default:
            throw new Error( `unknown type ${e.type}` );
            break;
        }
      }
    ).map(e=>e.replace(/(\s*,\s*)+$/,'')).join('\n'));

  output(`
    Conclusion
  =======================
  `);

  return s;
}

/*
 * fn_module_to_string()
 *
 * For further information about `fn_module_to_string()`,
 * see the function `index.js/BEGIN_MODULE()`
 *
 */
async function build(nargs) {
  return proc_build({
    ...nargs,
    fn_module_to_string : (module)=>module_to_source( module ),
    fn_check_directive  : (directive_arr)=>compare_arrays( directive_arr,  VANILLA_SCHEMA_VALIDATOR_DIRECTIVE_0 ),
    fn_output_filename  : (module)=>(module.output_filename ?? module.filename),
  });
}


async function build_doc(nargs) {
  await build_html(nargs);
  await build_md(nargs);
  return;
}


async function build_html(nargs) {
  return proc_build({
    ...nargs,
    fn_module_to_string : (module)=>module_to_html( module ),
    fn_check_directive  : (directive_arr)=>compare_arrays( directive_arr,  VANILLA_SCHEMA_VALIDATOR_DIRECTIVE_1 ),
    fn_output_filename  : (module)=>(module.output_filename ?? module.filename ) + '.html',
  });
}


async function build_md(nargs) {
  return proc_build({
    ...nargs,
    fn_module_to_string : (module)=>module_to_markdown( module ),
    fn_check_directive  : (directive_arr)=>compare_arrays( directive_arr,  VANILLA_SCHEMA_VALIDATOR_DIRECTIVE_1 ),
    fn_output_filename  : (module)=>(module.output_filename ?? module.filename ) + '.markdown',
  });
}



export {
  build,
  build_doc,
  build_html,
  build_md,
};