Ext.define('Proxmox.form.Tag', {
    extend: 'Ext.Component',
    alias: 'widget.pveTag',

    mode: 'editable',

    tag: '',
    cls: 'pve-edit-tag',

    tpl: [
        '<i class="handle fa fa-bars"></i>',
        '<span>{tag}</span>',
        '<i class="action fa fa-minus-square"></i>',
    ],

    focusable: true,
    getFocusEl: function () {
        return Ext.get(this.tagEl());
    },

    onFocus: function () {
        this.selectText();
    },

    // contains tags not to show in the picker and not allowing to set
    filter: [],

    updateFilter: function (tags) {
        this.filter = tags;
    },

    onClick: function (event) {
        let me = this;
        if (event.target.tagName === 'I' && !event.target.classList.contains('handle')) {
            if (me.mode === 'editable') {
                me.destroy();
                return;
            }
        } else if (event.target.tagName !== 'SPAN' || me.mode !== 'editable') {
            return;
        }
        me.selectText();
    },

    selectText: function (collapseToEnd) {
        let me = this;
        let tagEl = me.tagEl();
        tagEl.contentEditable = true;
        let range = document.createRange();
        range.selectNodeContents(tagEl);
        if (collapseToEnd) {
            range.collapse(false);
        }
        let sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        me.showPicker();
    },

    showPicker: function () {
        let me = this;
        if (!me.picker) {
            me.picker = Ext.widget({
                xtype: 'boundlist',
                minWidth: 70,
                scrollable: true,
                floating: true,
                hidden: true,
                userCls: 'proxmox-tags-full',
                displayField: 'tag',
                itemTpl: [
                    '{[Proxmox.Utils.getTagElement(values.tag, PVE.UIOptions.tagOverrides)]}',
                ],
                store: [],
                listeners: {
                    select: function (picker, rec) {
                        me.tagEl().innerHTML = rec.data.tag;
                        me.setTag(rec.data.tag, true);
                        me.selectText(true);
                        me.setColor(rec.data.tag);
                        me.picker.hide();
                    },
                },
            });
        }
        me.picker.getStore()?.clearFilter();
        let taglist = PVE.UIOptions.tagList
            .filter((v) => !me.filter.includes(v))
            .map((v) => ({ tag: v }));
        if (taglist.length < 1) {
            return;
        }
        me.picker.getStore().setData(taglist);
        me.picker.showBy(me, 'tl-bl');
        me.picker.setMaxHeight(200);
    },

    setMode: function (mode) {
        let me = this;
        let tagEl = me.tagEl();
        if (tagEl) {
            tagEl.contentEditable = mode === 'editable';
        }
        me.removeCls(me.mode);
        me.addCls(mode);
        me.mode = mode;
        if (me.mode !== 'editable') {
            me.picker?.hide();
        }
    },

    onKeyPress: function (event) {
        let me = this;
        let key = event.browserEvent.key;
        switch (key) {
            case 'Enter':
            case 'Escape':
                me.fireEvent('keypress', key);
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'Backspace':
            case 'Delete':
                return;
            default:
                if (key.match(PVE.Utils.tagCharRegex)) {
                    return;
                }
                me.setTag(me.tagEl().innerHTML);
        }
        event.browserEvent.preventDefault();
        event.browserEvent.stopPropagation();
    },

    // for pasting text
    beforeInput: function (event) {
        let me = this;
        me.updateLayout();
        let tag = event.event.data ?? event.event.dataTransfer?.getData('text/plain');
        if (!tag) {
            return;
        }
        if (tag.match(PVE.Utils.tagCharRegex) === null) {
            event.event.preventDefault();
            event.event.stopPropagation();
        }
    },

    onInput: function (event) {
        let me = this;
        me.picker.getStore().filter({
            property: 'tag',
            value: me.tagEl().innerHTML,
            anyMatch: true,
        });
        me.setTag(me.tagEl().innerHTML);
    },

    lostFocus: function (list, event) {
        let me = this;
        me.picker?.hide();
        window.getSelection().removeAllRanges();
    },

    setColor: function (tag) {
        let me = this;
        let rgb = PVE.UIOptions.tagOverrides[tag] ?? Proxmox.Utils.stringToRGB(tag);

        let cls = Proxmox.Utils.getTextContrastClass(rgb);
        let color = Proxmox.Utils.rgbToCss(rgb);
        me.setUserCls(`proxmox-tag-${cls}`);
        me.setStyle('background-color', color);
        if (rgb.length > 3) {
            let fgcolor = Proxmox.Utils.rgbToCss([rgb[3], rgb[4], rgb[5]]);

            me.setStyle('color', fgcolor);
        } else {
            me.setStyle('color');
        }
    },

    setTag: function (tag) {
        let me = this;
        let oldtag = me.tag;
        me.tag = tag;

        clearTimeout(me.colorTimeout);
        me.colorTimeout = setTimeout(() => me.setColor(tag), 200);

        me.updateLayout();
        if (oldtag !== tag) {
            me.fireEvent('change', me, tag, oldtag);
        }
    },

    tagEl: function () {
        return this.el?.dom?.getElementsByTagName('span')?.[0];
    },

    listeners: {
        click: 'onClick',
        focusleave: 'lostFocus',
        keydown: 'onKeyPress',
        beforeInput: 'beforeInput',
        input: 'onInput',
        element: 'el',
        scope: 'this',
    },

    initComponent: function () {
        let me = this;

        me.data = {
            tag: me.tag,
        };

        me.setTag(me.tag);
        me.setColor(me.tag);
        me.setMode(me.mode ?? 'normal');
        me.callParent();
    },

    destroy: function () {
        let me = this;
        if (me.picker) {
            Ext.destroy(me.picker);
        }
        clearTimeout(me.colorTimeout);
        me.callParent();
    },
});
