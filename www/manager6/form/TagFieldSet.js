Ext.define('PVE.form.TagFieldSet', {
    extend: 'Ext.form.FieldSet',
    alias: 'widget.pveTagFieldSet',
    mixins: ['Ext.form.field.Field'],

    title: gettext('Tags'),
    padding: '0 5 5 5',

    getValue: function () {
        let me = this;
        let tags = me
            .down('pveTagEditContainer')
            .getTags()
            .filter((t) => t !== '');
        return tags.join(';');
    },

    setValue: function (value) {
        let me = this;
        value ??= [];
        if (!Ext.isArray(value)) {
            value = value.split(/[;, ]/).filter((t) => t !== '');
        }
        me.down('pveTagEditContainer').loadTags(value.join(';'));
    },

    getErrors: function (value) {
        value ??= [];
        if (!Ext.isArray(value)) {
            value = value.split(/[;, ]/).filter((t) => t !== '');
        }
        if (value.some((t) => !t.match(PVE.Utils.tagCharRegex))) {
            return [gettext('Tags contain invalid characters.')];
        }
        return [];
    },

    getSubmitData: function () {
        let me = this;
        let value = me.getValue();
        if (me.disabled || !me.submitValue || value === '') {
            return null;
        }
        let data = {};
        data[me.getName()] = value;
        return data;
    },

    layout: 'fit',

    items: [
        {
            xtype: 'pveTagEditContainer',
            userCls: 'proxmox-tags-full proxmox-tag-fieldset',
            editOnly: true,
            allowBlank: true,
            layout: 'column',
            scrollable: true,
        },
    ],

    initComponent: function () {
        let me = this;
        me.callParent();
        me.initField();
    },
});
