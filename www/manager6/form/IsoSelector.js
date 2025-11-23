Ext.define('PVE.form.IsoSelector', {
    extend: 'Ext.container.Container',
    alias: 'widget.pveIsoSelector',
    mixins: ['Ext.form.field.Field', 'Proxmox.Mixin.CBind'],

    layout: {
        type: 'vbox',
        align: 'stretch',
    },

    nodename: undefined,
    insideWizard: false,
    labelWidth: undefined,
    labelAlign: 'right',

    cbindData: function () {
        let me = this;
        return {
            nodename: me.nodename,
            insideWizard: me.insideWizard,
        };
    },

    getValue: function () {
        return this.lookup('file').getValue();
    },

    setValue: function (value) {
        let me = this;
        if (!value) {
            me.lookup('file').reset();
            return;
        }
        var match = value.match(/^([^:]+):/);
        if (match) {
            me.lookup('storage').setValue(match[1]);
            me.lookup('file').setValue(value);
        }
    },

    getErrors: function () {
        let me = this;
        me.lookup('storage').validate();
        let file = me.lookup('file');
        file.validate();
        let value = file.getValue();
        if (!value || !value.length) {
            return ['']; // for validation
        }
        return [];
    },

    setNodename: function (nodename) {
        let me = this;
        me.lookup('storage').setNodename(nodename);
        me.lookup('file').setStorage(undefined, nodename);
    },

    setDisabled: function (disabled) {
        let me = this;
        me.lookup('storage').setDisabled(disabled);
        me.lookup('file').setDisabled(disabled);
        return me.callParent([disabled]);
    },

    referenceHolder: true,

    items: [
        {
            xtype: 'pveStorageSelector',
            reference: 'storage',
            isFormField: false,
            fieldLabel: gettext('Storage'),
            storageContent: 'iso',
            allowBlank: false,
            cbind: {
                nodename: '{nodename}',
                autoSelect: '{insideWizard}',
                insideWizard: '{insideWizard}',
                disabled: '{disabled}',
                labelWidth: '{labelWidth}',
                labelAlign: '{labelAlign}',
            },
            listeners: {
                change: function (f, value) {
                    let me = this;
                    let selector = me.up('pveIsoSelector');
                    selector.lookup('file').setStorage(value);
                    selector.checkChange();
                },
            },
        },
        {
            xtype: 'pveFileSelector',
            reference: 'file',
            isFormField: false,
            storageContent: 'iso',
            fieldLabel: gettext('ISO image'),
            labelAlign: 'right',
            cbind: {
                nodename: '{nodename}',
                disabled: '{disabled}',
                labelWidth: '{labelWidth}',
                labelAlign: '{labelAlign}',
            },
            allowBlank: false,
            listeners: {
                change: function () {
                    this.up('pveIsoSelector').checkChange();
                },
            },
        },
    ],
});
