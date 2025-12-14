// Re-export TextInput as TextField
// Since TextInput is a compounded component with Icon and Affix attached,
// they will be available as TextField.Icon and TextField.Affix
import TextInput from './TextInput/TextInput';
const TextField = TextInput as typeof TextInput;
export default TextField;
export type { Props as TextFieldProps } from './TextInput/TextInput';

