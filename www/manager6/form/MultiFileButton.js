// mostly copied from ExtJS FileButton, but added 'multiple' at the relevant
// places so we have a file picker where one can select multiple files
// changes are marked with an 'pmx:' comment
Ext.define('PVE.form.MultiFileButton', {
    extend: 'Ext.form.field.FileButton',
    alias: 'widget.pveMultiFileButton',

    afterTpl: [
        '<input id="{id}-fileInputEl" data-ref="fileInputEl" class="{childElCls} {inputCls}" ',
        'type="file" size="1" name="{inputName}" unselectable="on" multiple ', // pmx: added multiple
        '<tpl if="accept != null">accept="{accept}"</tpl>',
        '<tpl if="tabIndex != null">tabindex="{tabIndex}"</tpl>',
        '>',
    ],

    createFileInput: function (isTemporary) {
        var me = this,
            fileInputEl,
            listeners;

        fileInputEl = me.fileInputEl = me.el.createChild(
            {
                name: me.inputName || me.id,
                multiple: true, // pmx: added multiple option
                id: !isTemporary ? me.id + '-fileInputEl' : undefined,
                cls: me.inputCls + (me.getInherited().rtl ? ' ' + Ext.baseCSSPrefix + 'rtl' : ''),
                tag: 'input',
                type: 'file',
                size: 1,
                unselectable: 'on',
            },
            me.afterInputGuard,
        ); // Nothing special happens outside of IE/Edge

        // This is our focusEl
        fileInputEl.dom.setAttribute('data-componentid', me.id);

        if (me.tabIndex !== null) {
            me.setTabIndex(me.tabIndex);
        }

        if (me.accept) {
            fileInputEl.dom.setAttribute('accept', me.accept);
        }

        // We place focus and blur listeners on fileInputEl to activate Button's
        // focus and blur style treatment
        listeners = {
            scope: me,
            change: me.fireChange,
            mousedown: me.handlePrompt,
            keydown: me.handlePrompt,
            focus: me.onFileFocus,
            blur: me.onFileBlur,
        };

        if (me.useTabGuards) {
            listeners.keydown = me.onFileInputKeydown;
        }

        fileInputEl.on(listeners);
    },
});
